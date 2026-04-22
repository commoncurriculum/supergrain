import type { DocumentTypes } from "./memory";
import type { QueryConfig, QueryHandle, QueryTypes } from "./queries";

// =============================================================================
// Status
// =============================================================================

/**
 * - `IDLE`    – no fetch attempted (id was null/undefined)
 * - `PENDING` – first fetch in flight, no data yet
 * - `SUCCESS` – data present
 * - `ERROR`   – fetch failed, no fallback data available
 */
export type Status = "IDLE" | "PENDING" | "SUCCESS" | "ERROR";

// =============================================================================
// DocumentHandle — reactive handle returned by DocumentStore.find
// =============================================================================

/**
 * Reactive handle for a single document.
 *
 * A reactive view, not a class. A reactive state machine:
 *
 * ```
 * IDLE ──(id becomes non-null, not cached)──► PENDING
 * IDLE ──(id becomes non-null, cached)─────► SUCCESS
 * PENDING ──(finder resolves)──► SUCCESS
 * PENDING ──(finder rejects) ──► ERROR
 * ERROR   ──(later insertDocument)──► SUCCESS (new promise object)
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
 * `find`, the internal finder, and `insertDocument` update the handle's
 * fields directly as the lifecycle progresses. Reads inside a `tracked()`
 * scope subscribe per-property.
 *
 * Handle identity is stable — `store.find("user", "1")` returns the
 * same handle on every call.
 */
export interface DocumentHandle<T> {
  readonly status: Status;
  readonly data: T | undefined;
  readonly error: Error | undefined;
  /** True only before the first successful load. */
  readonly isPending: boolean;
  /** True whenever a fetch is in flight for this handle. */
  readonly isFetching: boolean;
  readonly hasData: boolean;
  /** Client wall-clock Date of the last successful fetch. */
  readonly fetchedAt: Date | undefined;
  /**
   * Stable Promise for use with React 19's `use()`.
   *
   * - Resolves exactly once on first successful load.
   * - If the first fetch errors, the promise rejects once.
   * - A later `insertDocument` after an error creates a NEW resolved promise
   *   object so a Suspense boundary inside an error boundary can recover.
   */
  readonly promise: Promise<T> | undefined;
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
// DocumentStore API
// =============================================================================

export interface DocStoreAPI<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
> {
  find<K extends keyof M & string>(type: K, id: string | null | undefined): DocumentHandle<M[K]>;
  findInMemory<K extends keyof M & string>(type: K, id: string): M[K] | undefined;
  insertDocument<K extends keyof M & string>(type: K, doc: M[K]): void;
  findQuery<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"] | null | undefined,
  ): QueryHandle<Q[K]["result"]>;
  findQueryInMemory<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"],
  ): Q[K]["result"] | undefined;
  insertQueryResult<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"],
    result: Q[K]["result"],
  ): void;
  clearMemory(): void;
}

/**
 * Public store shape returned by the document-store factory's internal init.
 *
 * This is a plain object API, not a constructable class.
 */
export type DocumentStore<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
> = DocStoreAPI<M, Q>;

/**
 * Create a plain document store object.
 *
 * This is the non-React primitive. React integrations wrap this via
 * `createDocumentStoreContext()`.
 */
export function createDocumentStore<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
>(_config: DocumentStoreConfig<M, Q>): DocumentStore<M, Q> {
  throw new Error("@supergrain/document-store: createDocumentStore is not yet implemented");
}

// Re-export query handle types so `store.findQuery(...)` call sites don't
// need a second import path. QueryHandle is defined in
// ./queries; this pass-through keeps the public surface single-origin.
export type { QueryHandle };
