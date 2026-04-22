import type { DocumentTypes, TypeRegistry } from "./memory";
import type { DocumentStore, Status } from "./store";

// =============================================================================
// QueryTypes — shape of a consumer's query type map
// =============================================================================

/**
 * Consumer-defined map of query name → `{ params, result }`. Each entry names
 * a query type (e.g. `"dashboard"`, `"usersByRole"`) and declares the shape
 * of its params (the cache key) and its result (the cacheable payload).
 *
 * Params must be JSON-serializable — the library stable-stringifies them for
 * cache identity. Dates, Maps, Sets, class instances, and functions are not
 * supported; stringify them yourself before passing.
 *
 * @example
 * ```ts
 * type TypeToQuery = {
 *   dashboard:   { params: { workspaceId: number };  result: Dashboard };
 *   usersByRole: { params: { role: string };          result: { userIds: string[] } };
 * };
 * ```
 */
export type QueryTypes = Record<string, { params: unknown; result: unknown }>;

// =============================================================================
// RegisteredQueries — module augmentation
// =============================================================================

/**
 * Extends `TypeRegistry` with an optional `queries` slot. Consumers augment
 * this once alongside `types` to tell the library about their query map.
 *
 * @example
 * ```ts
 * declare module "@supergrain/document-store" {
 *   interface TypeRegistry {
 *     types: TypeToModel;
 *     queries: TypeToQuery;
 *   }
 * }
 * ```
 */
export type RegisteredQueries = TypeRegistry extends {
  queries: infer Q extends QueryTypes;
}
  ? Q
  : Record<string, never>;

// =============================================================================
// QueryAdapter — consumer-owned transport for queries
// =============================================================================

/**
 * Talks to the API for a query model. Receives N params objects (raw —
 * the library does NOT stringify before handing off) and returns a raw
 * response. Behaves exactly like `DocumentAdapter` but `find` takes
 * `Array<Params>` instead of `Array<string>`.
 *
 * Stringification is only for the library's internal cache lookup, dedup,
 * and in-flight tracking. The adapter sees the original params.
 *
 * Contract:
 * - `find` is called with a chunk of at most `batchSize` params objects
 *   (the library dedupes concurrent deep-equal-param requests before
 *   calling the adapter).
 * - A rejection rejects every deferred waiting on that chunk.
 */
export interface QueryAdapter<Params> {
  find(paramsList: Array<Params>): Promise<unknown>;
}

// =============================================================================
// QueryProcessor — raw response → inserts
// =============================================================================

/**
 * Transforms a raw query-adapter response into store inserts.
 *
 * Unlike `ResponseProcessor` (which operates purely on documents), a query
 * processor receives the batch's input params (`paramsList`) as a fourth
 * argument so it can associate each result with the params that produced
 * it. The processor calls `store.insertQueryResult(type, params, result)`
 * for every result it wants cached.
 *
 * A query processor can also call `store.insertDocument(...)` to normalize
 * nested entities into the documents cache — this is how queries populate
 * the shared memory so `useDocument` reads benefit from results fetched
 * via queries. Example: a `usersByRole` query inserts each returned user
 * as a document, then stores the id-list as the query result.
 *
 * Contract:
 * - Synchronous. For async normalization, do it in the adapter before it returns.
 * - Must call `store.insertQueryResult(...)` for every result it wants
 *   cached — the library does NOT auto-insert anything from a processor.
 * - If the processor throws, all deferreds waiting on this chunk reject
 *   with the thrown error.
 */
export type QueryProcessor<
  M extends DocumentTypes,
  Q extends QueryTypes,
  Type extends keyof Q & string,
> = (
  raw: unknown,
  store: DocumentStore<M, Q>,
  type: Type,
  paramsList: ReadonlyArray<Q[Type]["params"]>,
) => void;

// =============================================================================
// Per-query config
// =============================================================================

/**
 * Per-query wiring: the adapter that talks to the API and the optional
 * processor that normalizes its response.
 *
 * If `processor` is omitted, the library uses `defaultQueryProcessor` —
 * assumes the adapter returns an array of results aligned 1:1 with the
 * input params, and pairs them by position. For envelope formats or
 * normalizing processors (inserting nested documents), supply a custom
 * `QueryProcessor`.
 */
export interface QueryConfig<
  M extends DocumentTypes,
  Q extends QueryTypes,
  Type extends keyof Q & string,
> {
  adapter: QueryAdapter<Q[Type]["params"]>;
  processor?: QueryProcessor<M, Q, Type>;
}

// =============================================================================
// QueryHandle — reactive handle returned by DocumentStore.findQuery
// =============================================================================

/**
 * Reactive handle for a single query result. Structurally identical to
 * `DocumentHandle<T>`: same `status` / `data` / `error` / `isPending` /
 * `isFetching` / `hasData` / `fetchedAt` / `promise` fields, same state
 * machine, same Suspense semantics. The alias makes hook return types
 * read clearly at call sites (`useQuery(...) → QueryHandle<Dashboard>`
 * vs. `useDocument(...) → DocumentHandle<User>`).
 */
export interface QueryHandle<T> {
  readonly status: Status;
  readonly data: T | undefined;
  readonly error: Error | undefined;
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly hasData: boolean;
  readonly fetchedAt: Date | undefined;
  readonly promise: Promise<T> | undefined;
}
