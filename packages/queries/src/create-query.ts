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
 * Create a reactive query handle for a paginated resource. Results and
 * sideloaded documents live in the store; fetches use the store's adapter
 * engine (retry, timeout, deadline, `onError`, `maxConcurrency`).
 *
 * - `refetch()` replaces the results with page 0, interrupting any in-flight fetch.
 * - `fetchNextPage()` waits for any in-flight fetch, then merges the next page
 *   by each result's `offset` (`results[result.offset] = result`).
 * - An empty response at any offset resets the results to `[]`.
 * - `params.subscribe` opts into live invalidation; each invalidation refetches.
 */
export function createQuery<
  M extends DocumentTypes,
  K extends keyof M & string,
  T extends { offset: number },
>(params: CreateQueryParams<M, K, T>): Query<T> {
  const { store, adapter, type, id } = params;
  const limit = params.limit ?? 200;
  // Only for commit failures, which happen outside `store.runAdapter`.
  const { onError } = store.resolveAdapterOptions();

  function reportError(error: SiloError, info: { attempt: number; retryable: boolean }): void {
    emitToSink(onError, error, {
      type,
      keys: [id],
      attempt: info.attempt,
      retryable: info.retryable,
    });
  }

  // Only the handle's fetch state is used; results live in the store.
  const handle = createReactive(makeIdleHandle()) as InternalHandle;
  const flight: Flight = { handle };
  let destroyed = false;

  function readSlot(): QueryModel<K, T> | undefined {
    return store.findInMemory(type, id) as QueryModel<K, T> | undefined;
  }

  function commitPage(res: QueryEnvelope<T>, offset: number): void {
    if (res.included) {
      for (const doc of res.included) {
        const docType = doc.type as keyof M & string;
        store.insertDocument(docType, doc as unknown as M[keyof M & string]);
      }
    }

    let results: Array<T> = [];
    if (res.data.results.length > 0) {
      if (offset === 0) {
        results = [...res.data.results];
      } else {
        const existing = readSlot();
        results = existing ? [...existing.results] : [];
        for (const r of res.data.results) {
          results[r.offset] = r;
        }
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
            onFailure: retrying,
          },
        ),
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
      // Superseding an in-flight page-0 refetch would merge this page onto stale
      // results. Loop: the awaited run may itself have been superseded.
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
