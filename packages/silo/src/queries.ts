import type { AdapterError, SiloError } from "./errors";
import type { ResilienceOptions } from "./resolve";
import type { DocumentHandle, DocumentStore, DocumentTypes, TypeRegistry } from "./store";
import type { Effect } from "effect";

/**
 * Map of query name → `{ params, result }`. Params are the cache key: use
 * primitives, plain objects, arrays, `Date`s and `bigint`s. Maps, Sets and
 * class instances are keyed only by their own-enumerable keys.
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

/**
 * The query map declared by augmenting `TypeRegistry` with `queries`.
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

/**
 * Talks to the API for a query model. Like `DocumentAdapter`, but `find` gets
 * the original params objects (deduped, at most `batchSize`) instead of ids.
 * Return a `Promise` (a rejection becomes an `AdapterError`) or an `Effect`.
 * A failure fails every request in the chunk. `ctx.signal` aborts when the
 * attempt is interrupted (e.g. a `timeout`).
 */
export interface QueryAdapter<Params> {
  find(
    paramsList: Array<Params>,
    ctx?: { signal?: AbortSignal },
  ): Promise<unknown> | Effect.Effect<unknown, AdapterError>;
}

/** Context handed to every {@link QueryProcessor}. */
export interface QueryProcessorContext<
  M extends DocumentTypes,
  Q extends QueryTypes,
  Type extends keyof Q & string,
> {
  /** The store — insert results with `insertQueryResult`, docs with `insertDocument`. */
  readonly store: DocumentStore<M, Q>;
  readonly type: Type;
  /** The batch's input params, aligned to the adapter's positional results. */
  readonly paramsList: ReadonlyArray<Q[Type]["params"]>;
}

/**
 * One step in a query's response pipeline, like `ResponseProcessor` but with
 * `paramsList` instead of `ids`. Returning a value replaces the response for
 * the next step; `undefined` / `null` passes it on unchanged. It may also call
 * `store.insertDocument` to normalize nested entities.
 *
 * - Synchronous; do async work in the adapter.
 * - Nothing is cached unless a step calls `store.insertQueryResult(...)`.
 * - A throw stops the pipeline and fails the chunk with a `ProcessorError`.
 */
export type QueryProcessor<
  M extends DocumentTypes,
  Q extends QueryTypes,
  Type extends keyof Q & string,
> = (response: unknown, context: QueryProcessorContext<M, Q, Type>) => unknown | void;

/**
 * Per-query adapter and response pipeline. Set `processor` or `processors`,
 * not both (that throws at store creation). With neither, results are paired
 * with params by array position. Resilience options override the store's.
 */
export interface QueryConfig<
  M extends DocumentTypes,
  Q extends QueryTypes,
  Type extends keyof Q & string,
> extends ResilienceOptions {
  adapter: QueryAdapter<Q[Type]["params"]>;
  processor?: QueryProcessor<M, Q, Type>;
  processors?: ReadonlyArray<QueryProcessor<M, Q, Type>>;
  /**
   * What a new result for params already loaded does: `"patch"` (default)
   * writes only the changed fields into the stored result; `"replace"` swaps
   * in the new object.
   */
  onRefetch?: "patch" | "replace";
}

/** Reactive handle for one query result; identical to `DocumentHandle`. */
export type QueryHandle<T, E = SiloError> = DocumentHandle<T, E>;
