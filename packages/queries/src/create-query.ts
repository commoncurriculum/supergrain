import type { CreateQueryParams, Query, QueryEnvelope, QueryModel } from "./types";

import { batch, createReactive } from "@supergrain/kernel";
import { type DocumentTypes, type SiloError } from "@supergrain/silo";
import {
  applyEvent,
  emitToSink,
  type Flight,
  HandleEvent,
  type InternalHandle,
  makeIdleHandle,
  runProcessor,
  runSingleFlight,
} from "@supergrain/silo/internal";

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
 * A fetch is **single-flight**: a new `refetch()` (or `destroy()`) interrupts
 * any in-flight fetch — its adapter `signal` aborts — so overlapping requests
 * can't race to write the store. `fetchNextPage()` instead *waits* for an
 * in-flight fetch (superseding it would silently drop a fresher page 0 and
 * merge the next page onto stale results), then reads `nextOffset` from what
 * actually landed. A superseded run's returned promise follows its
 * replacement, so `await refetch()` always reflects the state the query
 * settled into rather than fulfilling silently.
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

  // Report a commit failure to the store's telemetry sink — the same shared
  // sink-call rule (swallow contract included) the finder uses.
  function reportError(error: SiloError, info: { attempt: number; retryable: boolean }): void {
    emitToSink(onError, error, {
      type,
      keys: [id],
      attempt: info.attempt,
      retryable: info.retryable,
    });
  }

  // Transient fetch state, driven through silo's handle statechart so the
  // Fetch / Retrying / Failed / Settled transitions are the store's own —
  // not a reimplementation that can drift. The handle's `value` / `promise`
  // are unused here: results live in the store under `(type, id)`.
  const handle = createReactive(makeIdleHandle()) as InternalHandle;
  const flight: Flight = { handle };
  let destroyed = false;

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
    return runSingleFlight(flight, {
      type,
      keys: [id],
      run: (retrying) =>
        store.runAdapter<QueryEnvelope<T>>(
          (ctx) => adapter.fetch(id, { offset, limit, signal: ctx.signal }),
          {
            type,
            keys: [id],
            retry: params.retry,
            timeout: params.timeout,
            deadline: params.deadline,
            retryable: params.retryable,
            // `store.runAdapter` already reported the failure to the store's sink.
            onFailure: retrying,
          },
        ),
      // A throw while committing (a malformed envelope) fails the query with a
      // ProcessorError, the finder's own rule.
      commit: (res) => runProcessor(type, () => commitPage(res, offset)),
      report: (error) => reportError(error, { attempt: 1, retryable: false }),
    });
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
    async fetchNextPage(): Promise<void> {
      // Wait out any in-flight fetch (typically a live-invalidation refetch)
      // instead of superseding it — aborting would silently drop the fresher
      // page 0 and merge this page onto stale results. Re-check after each
      // wait: the run we waited on may itself have been superseded. The
      // offset is read after the wait so it reflects what actually landed.
      while (flight.inFlight !== undefined) await flight.inFlight;
      if (destroyed) return;
      const next = readSlot()?.nextOffset ?? 0;
      return fetchPage(next);
    },
    refetch(): Promise<void> {
      return fetchPage(0);
    },
    destroy(): void {
      destroyed = true;
      flight.controller?.abort();
      flight.controller = undefined;
      batch(() => applyEvent(handle, HandleEvent.aborted()));
      unsub?.();
    },
  };
}
