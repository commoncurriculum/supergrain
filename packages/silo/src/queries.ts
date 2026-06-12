import type { AdapterError, SiloError } from "./errors";
import type { ResilienceOptions } from "./resolve";
import type { DocumentHandle, DocumentStore, DocumentTypes, TypeRegistry } from "./store";
import type { Effect } from "effect";

// =============================================================================
// QueryTypes — shape of a consumer's query type map
// =============================================================================

/**
 * Consumer-defined map of query name → `{ params, result }`. Each entry names
 * a query type (e.g. `"dashboard"`, `"usersByRole"`) and declares the shape
 * of its params (the cache key) and its result (the cacheable payload).
 *
 * Params are stable-stringified for cache identity: primitives, plain objects,
 * arrays, `Date`s (encoded by timestamp), and `bigint`s are all supported.
 * Maps, Sets, and class instances are only distinguished by their
 * own-enumerable keys, so prefer plain JSON-ish params.
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
 * declare module "@supergrain/silo" {
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
 * the library does NOT stringify before handing off) and returns the raw
 * response. Behaves exactly like `DocumentAdapter` but `find` takes
 * `Array<Params>` instead of `Array<string>`: **return a `Promise`** (rejection
 * → `AdapterError`) or **return an `Effect`** for full control.
 *
 * Stringification is only for the library's internal cache lookup, dedup,
 * and in-flight tracking. The adapter sees the original params.
 *
 * Contract:
 * - `find` is called with a chunk of at most `batchSize` params objects
 *   (the library dedupes concurrent deep-equal-param requests before
 *   calling the adapter).
 * - A rejected Promise / failed Effect fails every deferred waiting on the chunk.
 * - `ctx.signal` aborts when the adapter Effect is interrupted (e.g. a
 *   per-query `timeout` fires); thread it into your transport for a real
 *   network abort, or ignore it.
 */
export interface QueryAdapter<Params> {
  find(
    paramsList: Array<Params>,
    ctx?: { signal?: AbortSignal },
  ): Promise<unknown> | Effect.Effect<unknown, AdapterError>;
}

// =============================================================================
// QueryProcessor — ordered response pipeline step (query surface)
// =============================================================================

/**
 * Context handed to every {@link QueryProcessor} in a query's pipeline: the
 * `store`, the `type` the caller passed to `findQuery(type, params)`, and the
 * chunk's input `paramsList` (so a result can be associated with the params
 * that produced it). Mirrors {@link import("./store").ProcessorContext} on the
 * document surface, with `paramsList` in place of `ids`.
 */
export interface QueryProcessorContext<
  M extends DocumentTypes,
  Q extends QueryTypes,
  Type extends keyof Q & string,
> {
  /** The store — insert results with `insertQueryResult`, docs with `insertDocument`. */
  readonly store: DocumentStore<M, Q>;
  /** The type the caller passed to `findQuery(type, params)` for this chunk. */
  readonly type: Type;
  /** The batch's input params, aligned to the adapter's positional results. */
  readonly paramsList: ReadonlyArray<Q[Type]["params"]>;
}

/**
 * One step in a query's ordered response pipeline.
 *
 * Like {@link import("./store").ResponseProcessor} on the document surface, but
 * its context carries the batch's input `paramsList` (instead of `ids`) so it
 * can associate each result with the params that produced it. Silo passes the
 * adapter response through each processor in order. A processor may **mutate**
 * the response, **return a replacement** response, perform **side effects**, or
 * **insert results** via `store.insertQueryResult(type, params, result)`. If it
 * returns `undefined` (or `null`), the current response continues unchanged to
 * the next processor. Most pipelines end with an insertion processor.
 *
 * A query processor can also call `store.insertDocument(...)` to normalize
 * nested entities into the documents cache — this is how queries populate the
 * shared memory so `useDocument` reads benefit from results fetched via
 * queries. Example: a `usersByRole` query inserts each returned user as a
 * document, then stores the id-list as the query result.
 *
 * Contract:
 * - Synchronous. For async normalization, do it in the adapter before it returns.
 * - The terminal step must call `store.insertQueryResult(...)` for every result
 *   it wants cached — the library does NOT auto-insert anything from a processor.
 * - If it throws, the remaining processors do not run and every deferred on the
 *   chunk fails with a `ProcessorError` (its `cause` is the thrown error).
 */
export type QueryProcessor<
  M extends DocumentTypes,
  Q extends QueryTypes,
  Type extends keyof Q & string,
> = (response: unknown, context: QueryProcessorContext<M, Q, Type>) => unknown | void;

// =============================================================================
// Per-query config
// =============================================================================

/**
 * Per-query wiring: the adapter that talks to the API and the response
 * processor(s) that turn its response into store inserts.
 *
 * Responses run through an **ordered pipeline**, configured either way:
 * - `processor` — a single {@link QueryProcessor} (normalized to a one-element
 *   pipeline).
 * - `processors` — an ordered array of {@link QueryProcessor}s, run in declared
 *   order.
 *
 * Supply at most one; setting **both** throws at store creation. If neither is
 * supplied, the library uses `defaultQueryProcessor` — assumes the adapter
 * returns an array of results aligned 1:1 with the input params, and pairs them
 * by position. For envelope formats or normalizing processors (inserting nested
 * documents), supply your own.
 *
 * The inherited resilience knobs ({@link ResilienceOptions}: `retry` /
 * `timeout` / `deadline` / `retryable` / `isolateFailures`) override the
 * store-wide defaults for this query — resolution precedence is per-query →
 * store-wide → built-in `defaultRetry`.
 */
export interface QueryConfig<
  M extends DocumentTypes,
  Q extends QueryTypes,
  Type extends keyof Q & string,
> extends ResilienceOptions {
  adapter: QueryAdapter<Q[Type]["params"]>;
  /** A single query processor. Mutually exclusive with `processors`. */
  processor?: QueryProcessor<M, Q, Type>;
  /**
   * An ordered query-response pipeline, run in declared order. Mutually
   * exclusive with `processor`.
   */
  processors?: ReadonlyArray<QueryProcessor<M, Q, Type>>;
}

// =============================================================================
// QueryHandle — reactive handle returned by DocumentStore.findQuery
// =============================================================================

/**
 * Reactive handle for a single query result — exactly a `DocumentHandle<T>`:
 * the same flat orthogonal fields (`value` / `error` / `isFetching` /
 * `fetchedAt`), same `promise`, same statechart, same Suspense semantics. The
 * alias exists so hook return types read clearly at call sites
 * (`useQuery(...) → QueryHandle<Dashboard>` vs. `useDocument(...) →
 * DocumentHandle<User>`).
 */
export type QueryHandle<T, E = SiloError> = DocumentHandle<T, E>;
