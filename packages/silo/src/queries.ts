import type { AdapterError, SiloError } from "./errors";
import type { DocumentHandle, DocumentStore, DocumentTypes, TypeRegistry } from "./store";
import type { Duration, Effect, Schedule } from "effect";

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
  /** Optional retry schedule applied to the adapter Effect on a retryable `AdapterError`. */
  retry?: Schedule.Schedule<unknown, AdapterError>;
  /** Optional per-attempt timeout for the adapter Effect; a timeout becomes an `AdapterError`. */
  timeout?: Duration.DurationInput;
  /**
   * Optional overall deadline across all retry attempts; a breach becomes a
   * non-retryable `AdapterError`. Distinct from the per-attempt `timeout`.
   */
  deadline?: Duration.DurationInput;
  /**
   * Optional predicate to classify a failure as retryable — for Promise-first
   * adapters that reject and so can't set the error's own `retryable` flag.
   * Inspect `error.cause` to veto retries on a deterministic failure.
   */
  retryable?: (error: AdapterError) => boolean;
  /**
   * When a multi-params query chunk fails terminally, split it and re-fetch the
   * halves to isolate the offending params. See {@link ModelConfig.isolateFailures}.
   */
  isolateFailures?: boolean;
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
