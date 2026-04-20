import type { DocumentTypes, Store } from "@supergrain/store";

// =============================================================================
// Query adapter
// =============================================================================

/**
 * Adapter shape for a paginated/queryable resource.
 *
 * Response envelope is fixed: `{ data: { results: Array<T> }, meta?, included? }`.
 * - `data.results` — the page's items. Each item is expected to carry its own
 *   `offset: number` (server-controlled positioning for stable ordering on
 *   later pages).
 * - `meta.nextOffset` — cursor for the next page, or `null` when exhausted.
 * - `included` — sideloaded documents written into the store via
 *   `store.insertDocument`.
 */
export interface QueryAdapter<T> {
  fetch(
    id: string,
    opts: { offset: number; limit: number },
  ): Promise<{
    data: { results: Array<T> };
    meta?: { nextOffset?: number | null };
    included?: Array<unknown>;
  }>;
}

// =============================================================================
// Query model (the shape stored in the document store)
// =============================================================================

/**
 * Conventional shape for a query's "document" in the store.
 *
 * A query result is stored as a single (type, id) slot whose value is a
 * `QueryModel`: the accumulated results array plus the next-page cursor.
 * Consumers declare this in their `DocumentTypes` map so the store's
 * reactivity is keyed by (queryName, queryParamId).
 */
export interface QueryModel<K extends string, T> {
  id: string;
  type: K;
  results: Array<T>;
  nextOffset: number | null;
}

// =============================================================================
// Reactive query handle
// =============================================================================

export interface Query<T> {
  readonly results: Array<T>;
  readonly nextOffset: number | null;
  readonly isFetching: boolean;
  readonly error: Error | undefined;

  /** Fetch the next page using the currently stored `nextOffset` (or 0 if none). */
  fetchNextPage(): Promise<void>;

  /** Refetch from offset 0, replacing the results array wholesale. */
  refetch(): Promise<void>;

  /** Unsubscribe and stop any pending retry timer. */
  destroy(): void;
}

// =============================================================================
// Params
// =============================================================================

export interface CreateQueryParams<
  M extends DocumentTypes,
  K extends keyof M & string,
  T extends { offset: number },
> {
  store: Store<M>;
  adapter: QueryAdapter<T>;
  type: K;
  id: string;

  /** Page size. Default 200. */
  limit?: number;

  /** Returns delay ms for a given attempt number (1-based). Default fibonacci (1s–60s). */
  backoff?: (attempt: number) => number;

  /**
   * Optional server-side subscription hook. If provided, called on init.
   * Must return an unsubscribe function that `destroy()` will invoke.
   *
   * The callback should be invoked whenever the server signals the query's
   * results are stale; the query will respond by refetching from offset 0.
   */
  subscribe?: (type: K, id: string, onInvalidate: () => void) => () => void;
}
