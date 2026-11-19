import type {
  AdapterError,
  AdapterOptionOverrides,
  DocumentStore,
  DocumentTypes,
  SiloError,
} from "@supergrain/silo";
import type { Effect } from "effect";

/**
 * Adapter for a paginated resource. `fetch` resolves with a {@link QueryEnvelope}:
 * - `data.results` — the page's items, each carrying its own `offset: number`.
 * - `meta.nextOffset` — cursor for the next page, or `null` when exhausted.
 * - `included` — sideloaded documents; each must carry its own `type` and `id`.
 *
 * Return a `Promise` (a rejection becomes an `AdapterError`) or an `Effect` to
 * control the failure channel. `opts.signal` aborts when the run is interrupted
 * (timeout, retry, destroy, or a newer fetch); pass it to your transport or ignore it.
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

/**
 * The document a query stores under its `(type, id)` slot. Declare it in your
 * `DocumentTypes` map for each query type.
 */
export interface QueryModel<K extends string, T> {
  id: string;
  type: K;
  results: Array<T>;
  nextOffset: number | null;
}

export interface Query<T> {
  readonly results: Array<T>;
  readonly nextOffset: number | null;
  readonly isFetching: boolean;
  /**
   * The failure from the last settled fetch, or `undefined`. A rejected `Promise`
   * adapter surfaces as an `AdapterError` (original rejection on `.cause`). A
   * previous error stays visible while a refetch is in flight.
   */
  readonly error: SiloError | undefined;
  /** Failed attempts in the current fetch cycle, reset to 0 on success. */
  readonly failureCount: number;
  /** The latest attempt's error while retrying, before `error` settles. */
  readonly lastError: SiloError | undefined;

  /** Fetch the next page using the currently stored `nextOffset` (or 0 if none). */
  fetchNextPage(): Promise<void>;

  /** Refetch from offset 0, replacing the results array wholesale. */
  refetch(): Promise<void>;

  /** Interrupt any in-flight fetch (aborting its adapter `signal`) and unsubscribe. */
  destroy(): void;
}

/**
 * `retry` / `timeout` / `deadline` / `retryable` override the store's adapter
 * defaults for this query, as in silo's `ModelConfig`. Disable retry with
 * `Schedule.recurs(0)`.
 */
export interface CreateQueryParams<
  M extends DocumentTypes,
  K extends keyof M & string,
  T extends { offset: number },
> extends AdapterOptionOverrides {
  store: DocumentStore<M>;
  adapter: QueryAdapter<T>;
  type: K;
  id: string;

  /** Page size. Default 200. */
  limit?: number;

  /**
   * Called on init. Call `onInvalidate` when the server says results are stale
   * (the query refetches from offset 0). Return an unsubscribe function, which
   * `destroy()` calls.
   */
  subscribe?: (type: K, id: string, onInvalidate: () => void) => () => void;
}
