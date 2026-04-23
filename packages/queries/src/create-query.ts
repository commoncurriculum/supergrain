import type { CreateQueryParams, Query, QueryModel } from "./types";
import type { DocumentTypes } from "@supergrain/silo";

import { signal } from "@supergrain/kernel";

import { fibonacciBackoff } from "./backoff";

/**
 * Create a reactive query handle for a paginated resource.
 *
 * Results, `nextOffset`, and sideloaded documents live in the store
 * (reactive via the store's per-(type,id) reactivity). Transient state
 * — `isFetching`, `error` — lives in local signals.
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
  const backoff = params.backoff ?? ((attempt: number) => fibonacciBackoff(attempt));

  const isFetching = signal(false);
  const errorSignal = signal<Error | null>(null);
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let destroyed = false;

  function readSlot(): QueryModel<K, T> | undefined {
    return store.findInMemory(type, id) as QueryModel<K, T> | undefined;
  }

  async function fetchPage(offset: number): Promise<void> {
    if (destroyed) return;

    isFetching(true);
    errorSignal(null);

    try {
      const res = await adapter.fetch(id, { offset, limit });
      if (destroyed) {
        isFetching(false);
        return;
      }

      if (res.included) {
        // Sideloaded `included` docs can be of any type — queries requires
        // each one to carry its own `type` field in the envelope (typical
        // JSON-API convention), since the core library's `insertDocument`
        // takes type as an explicit arg.
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

      attempts = 0;
      isFetching(false);
    } catch (error) {
      if (destroyed) {
        isFetching(false);
        return;
      }
      isFetching(false);
      errorSignal(error instanceof Error ? error : new Error(String(error)));
      attempts++;
      const delay = backoff(attempts);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void fetchPage(offset);
      }, delay);
    }
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
    get error(): Error | undefined {
      return errorSignal() ?? undefined;
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
      unsub?.();
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    },
  };
}
