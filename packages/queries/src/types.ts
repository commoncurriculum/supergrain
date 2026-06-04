import type { AdapterError, DocumentStore, DocumentTypes, SiloError } from "@supergrain/silo";
import type { Duration, Effect, Schedule } from "effect";

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
 * - `included` — sideloaded documents written into the store. Each item
 *   must carry its own `type` and `id` (JSON-API convention) so the query
 *   helper can insert it under the correct type. This is a queries-specific
 *   requirement on top of the core library's minimal `{ id }` contract.
 *
 * `fetch` returns the response envelope. **Return a `Promise`** for the common
 * case (a rejection becomes an `AdapterError`); power users can **return an
 * `Effect`** to control the failure channel — consistent with
 * `@supergrain/silo` adapters.
 *
 * `opts.signal` aborts when the run is interrupted (a per-query `timeout`
 * fires, a `retry` abandons the prior attempt, or the query is destroyed /
 * superseded by a newer fetch); thread it into your transport for a real
 * network abort, or ignore it — exactly like a silo `DocumentAdapter`.
 */
export interface QueryAdapter<T> {
  fetch(
    id: string,
    opts: { offset: number; limit: number; signal?: AbortSignal },
  ): Promise<QueryEnvelope<T>> | Effect.Effect<QueryEnvelope<T>, AdapterError>;
}

/** The fixed response envelope a {@link QueryAdapter} resolves with. */
export interface QueryEnvelope<T> {
  data: { results: Array<T> };
  meta?: { nextOffset?: number | null };
  included?: Array<{ type: string; id: string }>;
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
  /**
   * The typed failure from the last fetch, or `undefined`. Same `SiloError`
   * channel as a silo `DocumentHandle.error` — a rejected `Promise` adapter
   * surfaces as an `AdapterError` (original rejection on `.cause`).
   */
  readonly error: SiloError | undefined;

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
  store: DocumentStore<M>;
  adapter: QueryAdapter<T>;
  type: K;
  id: string;

  /** Page size. Default 200. */
  limit?: number;

  /**
   * Optional retry schedule applied to the adapter Effect on `AdapterError` —
   * the same knob as silo's `ModelConfig.retry`. Default: no retry (a failure
   * surfaces immediately on `error`, exactly like a silo document fetch).
   */
  retry?: Schedule.Schedule<unknown, AdapterError>;

  /** Optional timeout for the adapter Effect; a timeout becomes an `AdapterError`. */
  timeout?: Duration.DurationInput;

  /**
   * Optional server-side subscription hook. If provided, called on init.
   * Must return an unsubscribe function that `destroy()` will invoke.
   *
   * The callback should be invoked whenever the server signals the query's
   * results are stale; the query will respond by refetching from offset 0.
   */
  subscribe?: (type: K, id: string, onInvalidate: () => void) => () => void;
}
