import type { DocumentTypes } from "./memory";
import type { QueriesHandle, QueryConfig, QueryHandle, QueryTypes } from "./queries";

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
 * Two reactive channels drive the handle:
 * 1. `data` is a computed signal over `memoryEngine.find(type, id)`. It
 *    updates automatically whenever memory changes at that key — fetch
 *    completion, external `insertDocument`, socket push, `clearMemory`.
 * 2. `status`, `error`, `promise` are managed by `DocumentStore.find` based
 *    on the fetch outcome (resolves → SUCCESS, rejects → ERROR). `fetchedAt`
 *    updates on fetch-driven success only, not on unrelated memory writes.
 *
 * Handle identity is stable — `DocumentStore.find("user", "1")` returns the
 * same handle on every call.
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
// DocumentsHandle — aggregated reactive handle over a batch of document keys.
// Used by the React layer's `useDocuments` / `useHasMany`, which compose on
// `DocumentStore.find` per id. Collapsing the resulting fetches into one
// adapter call is the Finder's job.
// =============================================================================

/**
 * Aggregated reactive handle for a batch of documents referenced by ids.
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
 * collapses into one adapter call.
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
// DocumentAdapter — consumer-owned transport
// =============================================================================

/**
 * Talks to the API. Takes N ids and returns a raw response of whatever
 * shape the API produces. The adapter owns *how* the data is fetched:
 *
 * - one bulk GET (`/users?ids=1&ids=2`)
 * - N parallel single-doc GETs (`Promise.all(ids.map(id => fetch(...)))`)
 * - a websocket request/response cycle
 * - anything else
 *
 * The library doesn't inspect the raw response — only the paired
 * `ResponseProcessor` does. The adapter's only contract is: given ids,
 * eventually return some raw value (or reject).
 *
 * Contract:
 * - `find` is called with a chunk of at most `DocumentStoreConfig.batchSize`
 *   ids, grouped by type (the library dedupes concurrent same-id requests
 *   before calling the adapter, so the adapter never sees duplicate ids in
 *   one call).
 * - A rejection rejects every deferred waiting on that chunk.
 */
export interface DocumentAdapter {
  find(ids: Array<string>): Promise<unknown>;
}

// =============================================================================
// ResponseProcessor — raw response → inserts
// =============================================================================

/**
 * Transforms a raw adapter response into store inserts.
 *
 * A processor parses the raw response and calls `store.insertDocument(type,
 * doc)` for every document it wants cached — both the primary docs for the
 * type that was fetched, and any sideloaded docs of other types. It returns
 * nothing; the library looks up each requested `(type, id)` via
 * `store.findInMemory` after the processor completes to resolve deferreds.
 * Docs not found in memory after processing → the corresponding deferred
 * rejects with a "not found" error.
 *
 * The `type` argument is the type the caller originally passed to
 * `find(type, id)` (the same type every doc in this batch was requested
 * under). Processors whose raw response doesn't carry type info — e.g.
 * the `defaultProcessor` for APIs that return `{ id, ... }` with no type
 * field — use this argument as the primary type. Processors for envelope
 * formats that include type inline (like JSON-API's `data.type` /
 * `included[i].type`) can read type from the envelope and ignore the
 * argument.
 *
 * Contract:
 * - Synchronous. For async normalization, do it in the adapter before it returns.
 * - Must call `store.insertDocument(type, doc)` for every doc it wants
 *   cached — the library does NOT auto-insert anything from a processor.
 * - If the processor throws, all deferreds waiting on this chunk reject
 *   with the thrown error.
 */
export type ResponseProcessor<M extends DocumentTypes> = (
  raw: unknown,
  store: DocumentStore<M>,
  type: keyof M & string,
) => void;

// =============================================================================
// Per-model config
// =============================================================================

/**
 * Per-model wiring: the adapter that talks to the API and the optional
 * processor that normalizes its response.
 *
 * If `processor` is omitted, the library uses `defaultProcessor` — assumes
 * the adapter returns a doc or an array of docs, each inserted under the
 * model's type using the doc's own `id`. For envelopes (JSON-API, GraphQL,
 * bespoke), pass `jsonApiProcessor` from
 * `@supergrain/document-store/processors/json-api` or a custom
 * `ResponseProcessor`.
 */
export interface ModelConfig<M extends DocumentTypes> {
  adapter: DocumentAdapter;
  processor?: ResponseProcessor<M>;
}

// =============================================================================
// DocumentStore config
// =============================================================================

export interface DocumentStoreConfig<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
> {
  /**
   * Per-type adapter + optional processor wiring for documents (entities
   * keyed by `id: string`). The map's keys are the types the store can
   * serve; values supply the transport + parser.
   */
  models: { [K in keyof M]: ModelConfig<M> };
  /**
   * Per-type adapter + optional processor wiring for queries (results
   * keyed by structured params objects). Optional — omit if your app
   * only needs document lookups. Queries share the store's memory and
   * finder with documents: a query processor can call
   * `store.insertDocument(...)` to normalize nested entities into the
   * documents cache.
   */
  queries?: { [K in keyof Q & string]: QueryConfig<M, Q, K> };
  /**
   * Batch-window duration in ms. `find(type, id)` and `findQuery(type, params)`
   * calls within this window collapse into their respective
   * `adapter.find(...)` invocations. Default: 15.
   */
  batchWindowMs?: number;
  /**
   * Max keys per `adapter.find` call. Applies to both document adapters
   * (ids) and query adapters (params). Larger batches are chunked.
   * Default: 60.
   */
  batchSize?: number;
}

// =============================================================================
// DocumentStore
// =============================================================================

/**
 * Reactive document store.
 *
 * One-step wiring: the constructor takes per-model adapter/processor config
 * (plus optional per-query config and batching knobs) and owns all the
 * plumbing internally (a `MemoryEngine` for reactive caching, an internal
 * `Finder` for batched fetching). No separate Finder construction, no
 * two-step attach.
 *
 * The second generic `Q` is optional (defaults to an empty query map) and
 * lets consumers declare query-keyed models alongside document-keyed ones.
 * Consumers with only documents pass one generic (`M`); the query surface
 * is additive and adds no cost if unused.
 *
 * @example
 * ```ts
 * // Documents only (common case)
 * const store = new DocumentStore<TypeToModel>({
 *   models: {
 *     user: { adapter: userAdapter },
 *     "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
 *   },
 *   batchWindowMs: 15,
 *   batchSize: 60,
 * });
 *
 * // Documents + queries
 * const mixed = new DocumentStore<TypeToModel, TypeToQuery>({
 *   models: { user: { adapter: userAdapter } },
 *   queries: { dashboard: { adapter: dashboardAdapter } },
 * });
 * ```
 */
export class DocumentStore<M extends DocumentTypes, Q extends QueryTypes = Record<string, never>> {
  constructor(_config: DocumentStoreConfig<M, Q>) {
    throw new Error("@supergrain/document-store: DocumentStore constructor is not yet implemented");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Documents — entities keyed by `id: string`
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Find a document. Checks memory first, falls back to the internal finder
   * (which batches, fetches, and inserts). Returns a reactive handle.
   *
   * - `null`/`undefined` id → idle handle, no fetch attempted
   * - Same `(type, id)` always returns the same handle object (stable identity)
   */
  find<K extends keyof M & string>(_type: K, _id: string | null | undefined): DocumentHandle<M[K]> {
    throw new Error("@supergrain/document-store: DocumentStore.find is not yet implemented");
  }

  /**
   * Direct memory lookup for a document. No fetch. Returns the document or
   * undefined. Reactive — reads inside a tracked() scope subscribe to changes.
   */
  findInMemory<K extends keyof M & string>(_type: K, _id: string): M[K] | undefined {
    throw new Error(
      "@supergrain/document-store: DocumentStore.findInMemory is not yet implemented",
    );
  }

  /**
   * Insert or update a document under the given type. Keyed by
   * `(type, doc.id)`. Fully reactive — any handles or tracked scopes reading
   * this key will update.
   */
  insertDocument<K extends keyof M & string>(_type: K, _doc: M[K]): void {
    throw new Error(
      "@supergrain/document-store: DocumentStore.insertDocument is not yet implemented",
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Queries — results keyed by structured params
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Find a query result. Checks memory first (keyed by the stringified
   * params), falls back to the internal finder. Returns a reactive handle.
   *
   * - `null`/`undefined` params → idle handle, no fetch attempted
   * - Deep-equal params always return the same handle object (stable
   *   identity across `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }`)
   */
  findQuery<K extends keyof Q & string>(
    _type: K,
    _params: Q[K]["params"] | null | undefined,
  ): QueryHandle<Q[K]["result"]> {
    throw new Error("@supergrain/document-store: DocumentStore.findQuery is not yet implemented");
  }

  /**
   * Direct memory lookup for a query result. No fetch. Returns the result
   * or undefined. Reactive — reads inside a tracked() scope subscribe to
   * changes.
   */
  findQueryInMemory<K extends keyof Q & string>(
    _type: K,
    _params: Q[K]["params"],
  ): Q[K]["result"] | undefined {
    throw new Error(
      "@supergrain/document-store: DocumentStore.findQueryInMemory is not yet implemented",
    );
  }

  /**
   * Insert or update a query result under the given type + params. Keyed by
   * `(type, stableStringify(params))`. Fully reactive — any handles or
   * tracked scopes reading this key will update. Deep-equal params hit the
   * same slot.
   */
  insertQueryResult<K extends keyof Q & string>(
    _type: K,
    _params: Q[K]["params"],
    _result: Q[K]["result"],
  ): void {
    throw new Error(
      "@supergrain/document-store: DocumentStore.insertQueryResult is not yet implemented",
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Shared
  // ───────────────────────────────────────────────────────────────────────────

  /** Clear all documents and query results from memory. */
  clearMemory(): void {
    throw new Error("@supergrain/document-store: DocumentStore.clearMemory is not yet implemented");
  }
}

// Re-export query handle types so `store.findQuery(...)` call sites don't
// need a second import path. QueryHandle / QueriesHandle are defined in
// ./queries; this pass-through keeps the public surface single-origin.
export type { QueriesHandle, QueryHandle };
