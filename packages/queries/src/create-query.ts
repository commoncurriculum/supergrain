import type { CreateQueryParams, Query, QueryEnvelope, QueryModel } from "./types";

import { batch, createReactive, unwrap } from "@supergrain/kernel";
import { AdapterError, type DocumentTypes, ProcessorError, type SiloError } from "@supergrain/silo";
import {
  applyEvent,
  HandleEvent,
  type InternalHandle,
  makeIdleHandle,
} from "@supergrain/silo/internal";
import { Effect } from "effect";

/**
 * Create a reactive query handle for a paginated resource.
 *
 * Results, `nextOffset`, and sideloaded documents live in the store (reactive
 * via the store's per-(type,id) reactivity). Transient state — `isFetching`,
 * `error`, `failureCount`, `lastError` — lives in a silo handle driven by the
 * store's own statechart, so it transitions exactly like a document handle's.
 *
 * Fetching runs on the **same engine** as a silo document fetch: every attempt
 * goes through `store.runAdapter`, so `retry` (a `Schedule`) / `timeout` /
 * `deadline` (`Duration`s) / abort behave exactly as they do for
 * `ModelConfig`, every failure reports to the store's `onError` sink, and the
 * fetch counts against the store's `maxConcurrency`. With no per-query
 * overrides, the store's resolved defaults apply (the built-in fibonacci
 * `defaultRetry` bounded by `defaultDeadline` unless the store overrides
 * them) — disable retry with `Schedule.recurs(0)`.
 *
 * A fetch is **single-flight**: starting a new `refetch()` / `fetchNextPage()`
 * (or `destroy()`) interrupts any in-flight fetch — its adapter `signal`
 * aborts — so overlapping requests can't race to write the store.
 *
 * Pagination semantics (matches the Ember `live-query` helper):
 * - `refetch()` (offset 0, non-empty response) replaces the results array
 *   wholesale, preserving the server's response order.
 * - `fetchNextPage()` merges results by server-provided `offset`
 *   (`results[result.offset] = result`) on top of the existing array.
 * - An empty response at any offset resets the results array to `[]`.
 *
 * Live subscription is opt-in via `params.subscribe`, which typically wraps
 * the app's socket transport. When the subscriber fires `onInvalidate`,
 * the query refetches from offset 0.
 */
export function createQuery<
  M extends DocumentTypes,
  K extends keyof M & string,
  T extends { offset: number },
>(params: CreateQueryParams<M, K, T>): Query<T> {
  const { store, adapter, type, id } = params;
  const limit = params.limit ?? 200;
  // Fetches run through `store.runAdapter`, which resolves the per-call knobs
  // below over the store's defaults, reports every engine failure to the
  // store's `onError` sink, and counts against the store's `maxConcurrency`.
  // The sink is only needed directly for post-success commit failures, which
  // happen outside the engine.
  const { onError } = store.resolveAdapterOptions();

  // Report a commit failure to the store's telemetry sink. A throwing sink is
  // swallowed: observability can't affect fetch state.
  function reportError(error: SiloError, info: { attempt: number; retryable: boolean }): void {
    if (onError === undefined) return;
    try {
      onError(error, { type, keys: [id], attempt: info.attempt, retryable: info.retryable });
    } catch {
      // Swallowed — same contract as the finder's onError isolation.
    }
  }

  // Transient fetch state, driven through silo's handle statechart so the
  // Fetch / Retrying / Failed / Settled transitions are the store's own —
  // not a reimplementation that can drift. The handle's `value` / `promise`
  // are unused here: results live in the store under `(type, id)`.
  const handle = createReactive(makeIdleHandle()) as InternalHandle;
  let destroyed = false;
  // The controller for the currently-owned fetch; aborting it interrupts the
  // run (and the adapter's `signal`). A superseded fetch is no longer the
  // active one, so its settle/teardown is ignored.
  let activeController: AbortController | undefined = undefined;

  function readSlot(): QueryModel<K, T> | undefined {
    return store.findInMemory(type, id) as QueryModel<K, T> | undefined;
  }

  /** Write a successful page into the store (sideloads + merged results). */
  function commitPage(res: QueryEnvelope<T>, offset: number): void {
    if (res.included) {
      // Sideloaded `included` docs can be of any type — queries requires each
      // one to carry its own `type` field in the envelope (typical JSON-API
      // convention), since the core library's `insertDocument` takes type as
      // an explicit arg.
      for (const doc of res.included) {
        const docType = doc.type as keyof M & string;
        store.insertDocument(docType, doc as unknown as M[keyof M & string]);
      }
    }

    let results: Array<T> = [];
    if (res.data.results.length === 0) {
      results = [];
    } else if (offset === 0) {
      results = [...res.data.results];
    } else {
      const existing = readSlot();
      results = existing ? [...existing.results] : [];
      for (const r of res.data.results) {
        results[r.offset] = r;
      }
    }

    const nextOffset = res.meta?.nextOffset ?? null;
    const doc: QueryModel<K, T> = { id, type, results, nextOffset };
    store.insertDocument(type, doc as unknown as M[K]);
  }

  function fetchPage(offset: number): Promise<void> {
    if (destroyed) return Promise.resolve();

    // Single-flight: interrupt whatever was in flight before starting anew.
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    // Mark activity and reset the failure tally for the fresh cycle. The Fetch
    // event bumps the handle's generation; every event this run emits below is
    // stamped with it, so the statechart itself fences out anything a
    // superseded run might land late — state correctness doesn't depend on
    // interruption timing.
    batch(() => applyEvent(handle, HandleEvent.fetch()));
    const { generation } = unwrap(handle);

    const program = store
      .runAdapter<QueryEnvelope<T>>(
        (ctx) => adapter.fetch(id, { offset, limit, signal: ctx.signal }),
        {
          type,
          keys: [id],
          retry: params.retry,
          timeout: params.timeout,
          deadline: params.deadline,
          retryable: params.retryable,
          // Surface each failed attempt (and a deadline breach) while retrying,
          // so a still-fetching query isn't silent — the same transition as a
          // silo handle mid-retry. `store.runAdapter` already reported it to the
          // store's telemetry sink.
          onFailure: (error) =>
            batch(() => applyEvent(handle, HandleEvent.retrying(error, generation))),
        },
      )
      .pipe(
        Effect.flatMap((res) =>
          // A throw while committing (malformed envelope, a frozen-doc insert
          // failing) joins the typed channel as a ProcessorError — the queries
          // analogue of the finder's processor coercion — instead of escaping as
          // a defect that the Aborted safety net would silently swallow.
          Effect.suspend(() => {
            try {
              batch(() => {
                commitPage(res, offset);
                applyEvent(handle, HandleEvent.settled(generation));
              });
              return Effect.void;
            } catch (error) {
              return Effect.fail(new ProcessorError({ type, cause: error }));
            }
          }),
        ),
        Effect.catchAll((error: SiloError) =>
          Effect.sync(() => {
            // Adapter failures were already reported per attempt by
            // `store.runAdapter` (including the terminal one and a deadline
            // breach); a commit failure is a single post-success observation,
            // reported here.
            if (error instanceof ProcessorError) {
              reportError(error, { attempt: 1, retryable: false });
            }
            batch(() => applyEvent(handle, HandleEvent.failed(error, generation)));
          }),
        ),
        // Nothing above may escape as a defect — it would bypass Failed and be
        // discarded by runPromiseExit, making the failure invisible. Anything
        // unexpectedly thrown (e.g. an adapter Effect dying) settles the handle
        // as a non-retryable `reason: "defect"` AdapterError.
        Effect.catchAllDefect((defect) =>
          Effect.sync(() => {
            const error = new AdapterError({
              type,
              keys: [id],
              cause: defect,
              retryable: false,
              reason: "defect",
            });
            reportError(error, { attempt: 1, retryable: false });
            batch(() => applyEvent(handle, HandleEvent.failed(error, generation)));
          }),
        ),
        // Settled/Failed already ended activity on every live path; this is the
        // safety net for a run interrupted without settling. Stamped with this
        // run's generation, so when a newer fetch has taken over (its Fetch
        // bumped the generation) the statechart drops it instead of clobbering
        // the fresh cycle's activity.
        Effect.ensuring(
          Effect.sync(() => batch(() => applyEvent(handle, HandleEvent.aborted(generation)))),
        ),
      );

    // `runPromiseExit` resolves (never rejects) on interruption, so a
    // superseded/destroyed fetch settles quietly.
    return Effect.runPromiseExit(program, { signal: controller.signal }).then(() => {});
  }

  const unsub = params.subscribe?.(type, id, () => {
    void fetchPage(0);
  });

  return {
    get results(): Array<T> {
      return readSlot()?.results ?? [];
    },
    get nextOffset(): number | null {
      return readSlot()?.nextOffset ?? null;
    },
    get isFetching(): boolean {
      return handle.isFetching;
    },
    get error(): SiloError | undefined {
      return handle.error;
    },
    get failureCount(): number {
      return handle.failureCount;
    },
    get lastError(): SiloError | undefined {
      return handle.lastError;
    },
    fetchNextPage(): Promise<void> {
      const next = readSlot()?.nextOffset ?? 0;
      return fetchPage(next);
    },
    refetch(): Promise<void> {
      return fetchPage(0);
    },
    destroy(): void {
      destroyed = true;
      activeController?.abort();
      activeController = undefined;
      batch(() => applyEvent(handle, HandleEvent.aborted()));
      unsub?.();
    },
  };
}
