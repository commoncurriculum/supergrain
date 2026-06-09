import type { CreateQueryParams, Query, QueryEnvelope, QueryModel } from "./types";

import { batch, createReactive } from "@supergrain/kernel";
import { type DocumentTypes, runAdapter, type SiloError } from "@supergrain/silo";
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
 * goes through `runAdapter`, so `retry` (a `Schedule`) / `timeout` (a
 * `Duration`) / abort behave exactly as they do for `ModelConfig`, and a
 * failure surfaces as a typed `SiloError`. With no per-query `retry`, the
 * store's resolved default applies (the built-in fibonacci `defaultRetry`
 * unless the store overrides it) — disable with `Schedule.recurs(0)`.
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
  // Inherit the store's resolved resilience (store-wide `retry` ?? the built-in
  // fibonacci `defaultRetry`, plus `timeout` / `deadline`) so a query fetch
  // behaves like a document `find` unless the call overrides them. Resolution
  // lives in the store, not here.
  const { retry, timeout, deadline, retryable } = store.resolveAdapterOptions({
    retry: params.retry,
    timeout: params.timeout,
    deadline: params.deadline,
    retryable: params.retryable,
  });

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
    // Mark activity and reset the failure tally for the fresh cycle.
    batch(() => applyEvent(handle, HandleEvent.fetch()));

    // Supersession (a newer fetch, or `destroy()`) aborts this run's controller,
    // which interrupts the fiber — so the success/error/`onFailure` channel below
    // never runs once we've lost ownership; reaching it means we're still the
    // active run. Only the `ensuring` finalizer runs *on* interruption, so that's
    // the single place that must guard against clobbering a fresh fetch's state.
    const owned = (): boolean => !destroyed && controller === activeController;

    const program = runAdapter<QueryEnvelope<T>>(
      (ctx) => adapter.fetch(id, { offset, limit, signal: ctx.signal }),
      {
        type,
        keys: [id],
        retry,
        timeout,
        deadline,
        retryable,
        // Surface each failed attempt (and a deadline breach) while retrying, so
        // a still-fetching query isn't silent — the same transition as a silo
        // handle mid-retry.
        onFailure: (error) => batch(() => applyEvent(handle, HandleEvent.retrying(error))),
      },
    ).pipe(
      Effect.flatMap((res) =>
        Effect.sync(() =>
          batch(() => {
            commitPage(res, offset);
            applyEvent(handle, HandleEvent.settled());
          }),
        ),
      ),
      Effect.catchAll((error: SiloError) =>
        Effect.sync(() => batch(() => applyEvent(handle, HandleEvent.failed(error)))),
      ),
      // Settled/Failed already ended activity on every live path; this is the
      // safety net for a run that dies without settling (e.g. a defect thrown
      // while committing). Guarded so an interrupted (superseded / destroyed)
      // run can't clobber the fresh fetch's activity.
      Effect.ensuring(
        Effect.sync(() => {
          if (owned()) batch(() => applyEvent(handle, HandleEvent.aborted()));
        }),
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
