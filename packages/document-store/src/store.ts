import type { Finder } from "./finder";
import type { DocumentTypes } from "./memory";

// =============================================================================
// Status
// =============================================================================

/**
 * - `IDLE`    – no fetch attempted (id was null/undefined)
 * - `PENDING` – first fetch in flight, no data yet
 * - `SUCCESS` – data present (may also be refetching; check `isFetching`)
 * - `ERROR`   – fetch failed, no fallback data available
 */
export type Status = "IDLE" | "PENDING" | "SUCCESS" | "ERROR";

// =============================================================================
// DocumentHandle — reactive handle returned by DocumentStore.find
// =============================================================================

/**
 * Reactive handle for a single document.
 *
 * A signal-backed view, not a class — the implementation builds one via
 * `@supergrain/core` primitives internally. A reactive state machine:
 *
 * ```
 * IDLE ──(id becomes non-null, not cached)──► PENDING
 * IDLE ──(id becomes non-null, cached)─────► SUCCESS
 * PENDING ──(finder resolves)──► SUCCESS
 * PENDING ──(finder rejects) ──► ERROR
 * SUCCESS ──(refetch)──► SUCCESS (with isFetching: true mid-flight)
 * ERROR   ──(refetch)──► PENDING, then SUCCESS (new promise object)
 * ```
 *
 * Idle invariant — when `status === "IDLE"`, all of:
 * - `data === undefined`
 * - `error === undefined`
 * - `isPending === false`
 * - `isFetching === false`
 * - `hasData === false`
 * - `fetchedAt === undefined`
 * - `promise === undefined`
 *
 * All fields are reactive: reading them inside a `tracked()` scope subscribes
 * to changes. Handle identity is stable — `DocumentStore.find("user", "1")`
 * returns the same handle on every call.
 */
export interface DocumentHandle<T> {
  readonly status: Status;
  readonly data: T | undefined;
  readonly error: Error | undefined;
  /** True only before the first successful load. */
  readonly isPending: boolean;
  /** True whenever any fetch (initial OR refetch) is in flight. */
  readonly isFetching: boolean;
  readonly hasData: boolean;
  /** Client wall-clock Date of the last successful fetch. */
  readonly fetchedAt: Date | undefined;
  /**
   * Stable Promise for use with React 19's `use()`.
   *
   * - Resolves exactly once on first successful load.
   * - Refetches do NOT create new promises — they update `data`/`isFetching`.
   * - If the first fetch errors, the promise rejects once.
   * - A successful refetch AFTER an error creates a NEW promise object (so a
   *   Suspense boundary inside an error boundary can recover).
   */
  readonly promise: Promise<T> | undefined;
}

// =============================================================================
// DocumentsHandle — reactive handle returned by DocumentStore.findMany
// =============================================================================

/**
 * Aggregated reactive handle for a batch of documents fetched by ids.
 *
 * Same state machine as `DocumentHandle<T>`, rolled up across the set:
 *
 * - `PENDING` while any doc is still loading for its first time
 * - `SUCCESS` when all have resolved (`data` is the full array)
 * - `ERROR` if any failed (`error` is the first failure seen)
 *
 * Use when you need a single aggregate state ("show spinner until all
 * docs ready"). For per-doc state in a list, render subcomponents that
 * each call `DocumentStore.find` — the batching across them still
 * collapses into one network request.
 */
export interface DocumentsHandle<T> {
  readonly status: Status;
  readonly data: ReadonlyArray<T> | undefined;
  readonly error: Error | undefined;
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly hasData: boolean;
  readonly fetchedAt: Date | undefined;
  readonly promise: Promise<ReadonlyArray<T>> | undefined;
}

// =============================================================================
// DocumentStore config
// =============================================================================

export interface DocumentStoreConfig<M extends DocumentTypes> {
  /**
   * Finder used for `DocumentStore.find` fallback when a document isn't in
   * memory. Construct with `new Finder({...})` and pass it here.
   */
  finder: Finder<M>;
}

// =============================================================================
// DocumentStore
// =============================================================================

/**
 * Reactive document store.
 *
 * Thin orchestrator over a `MemoryEngine` (reactive in-memory cache) and a
 * `Finder` (batched fetching). The constructor attaches the store to the
 * finder so `DocumentStore.find` can fall back to the finder on cache miss.
 *
 * @example
 * ```ts
 * const finder = new Finder<TypeToModel>({
 *   models: { user: { adapter: userAdapter } },
 * });
 * const store = new DocumentStore<TypeToModel>({ finder });
 * ```
 */
export class DocumentStore<M extends DocumentTypes> {
  constructor(config: DocumentStoreConfig<M>) {
    config.finder.attachStore(this);
  }

  /**
   * Find a document. Checks memory first, falls back to the finder
   * (which batches, fetches, and inserts). Returns a reactive handle.
   *
   * - `null`/`undefined` id → idle handle, no fetch attempted
   * - Same `(type, id)` always returns the same handle object (stable identity)
   */
  find<K extends keyof M & string>(_type: K, _id: string | null | undefined): DocumentHandle<M[K]> {
    throw new Error("@supergrain/document-store: DocumentStore.find is not yet implemented");
  }

  /**
   * Find many documents by ids. Batches into a single adapter call, returns
   * an aggregate reactive handle.
   *
   * - Empty `ids` → idle handle
   * - Same `(type, ids)` on repeat calls returns the same handle (identity
   *   based on type + sorted-joined ids)
   */
  findMany<K extends keyof M & string>(
    _type: K,
    _ids: ReadonlyArray<string>,
  ): DocumentsHandle<M[K]> {
    throw new Error("@supergrain/document-store: DocumentStore.findMany is not yet implemented");
  }

  /**
   * Direct memory lookup. No fetch, no finder. Returns the document
   * or undefined. Reactive — reads inside a tracked() scope subscribe
   * to changes.
   */
  findInMemory<K extends keyof M & string>(_type: K, _id: string): M[K] | undefined {
    throw new Error(
      "@supergrain/document-store: DocumentStore.findInMemory is not yet implemented",
    );
  }

  /**
   * Insert or update a document in the store. Keyed by `doc.type` and
   * `doc.id`. Fully reactive — any handles or tracked scopes reading
   * this document will update.
   */
  insertDocument(_doc: M[keyof M]): void {
    throw new Error(
      "@supergrain/document-store: DocumentStore.insertDocument is not yet implemented",
    );
  }

  /** Clear all documents from memory. */
  clearMemory(): void {
    throw new Error("@supergrain/document-store: DocumentStore.clearMemory is not yet implemented");
  }
}
