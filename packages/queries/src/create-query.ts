import type { CreateQueryParams, Query, QueryEnvelope, QueryModel } from "./types";

import { signal } from "@supergrain/kernel";
import { type DocumentTypes, runAdapter, type SiloError } from "@supergrain/silo";
import { Effect } from "effect";

/**
 * Create a reactive query handle for a paginated resource.
 *
 * Results, `nextOffset`, and sideloaded documents live in the store (reactive
 * via the store's per-(type,id) reactivity). Transient state — `isFetching`,
 * `error` — lives in local signals.
 *
 * Fetching runs on the **same engine** as a silo document fetch: every attempt
 * goes through `runAdapter`, so `retry` (a `Schedule`) / `timeout` (a
 * `Duration`) / abort behave exactly as they do for `ModelConfig`, and a
 * failure surfaces as a typed `SiloError`. There is no built-in auto-retry —
 * like the store, a failure settles `error` immediately unless you pass
 * `retry`.
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

  const isFetching = signal(false);
  const errorSignal = signal<SiloError | null>(null);
  const lastErrorSignal = signal<SiloError | null>(null);
  const failureCountSignal = signal(0);
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
    errorSignal(null);
    // A recovering retry succeeded — clear the in-flight failure tally.
    lastErrorSignal(null);
    failureCountSignal(0);
  }

  function fetchPage(offset: number): Promise<void> {
    if (destroyed) return Promise.resolve();

    // Single-flight: interrupt whatever was in flight before starting anew.
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    isFetching(true);
    errorSignal(null);
    // Fresh cycle: reset the failure tally before the first attempt.
    lastErrorSignal(null);
    failureCountSignal(0);

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
        // a still-fetching query isn't silent — mirrors a silo handle.
        onFailure: (error, info) => {
          lastErrorSignal(error);
          failureCountSignal(info.attempt);
        },
      },
    ).pipe(
      Effect.flatMap((res) => Effect.sync(() => commitPage(res, offset))),
      Effect.catchAll((error: SiloError) => Effect.sync(() => errorSignal(error))),
      Effect.ensuring(
        Effect.sync(() => {
          if (owned()) isFetching(false);
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
      return isFetching();
    },
    get error(): SiloError | undefined {
      return errorSignal() ?? undefined;
    },
    get failureCount(): number {
      return failureCountSignal();
    },
    get lastError(): SiloError | undefined {
      return lastErrorSignal() ?? undefined;
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
      isFetching(false);
      unsub?.();
    },
  };
}
