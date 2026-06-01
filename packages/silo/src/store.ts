import type { AdapterError, SiloError } from "./errors";
import type { QueryConfig, QueryHandle, QueryTypes } from "./queries";
import type { Duration, Schedule } from "effect";

import { batch, createReactive } from "@supergrain/kernel";
import { Effect } from "effect";

import { Finder } from "./finder";
import { applyEvent, HandleEvent, type InternalHandle, makeIdleHandle } from "./transitions";

interface InternalState {
  documents: Map<string, Map<string, InternalHandle>>;
  queries: Map<string, Map<string, InternalHandle>>;
}

function ensureBucket<T>(buckets: Map<string, Map<string, T>>, type: string): Map<string, T> {
  if (!buckets.get(type)) {
    buckets.set(type, new Map<string, T>());
  }
  return buckets.get(type)!;
}

export type { InternalState };

// =============================================================================
// Model types
// =============================================================================

/**
 * Consumer-defined map of type name → model shape.
 *
 * Each key is a type string (e.g. "user", "card-stack"), each value is the
 * full model type as defined by the consumer. The library doesn't impose
 * structure on the model beyond requiring an `id: string`.
 *
 * @example
 * ```ts
 * type TypeToModel = {
 *   user: User;           // User need only carry `id: string`
 *   "card-stack": CardStack;
 * };
 * ```
 */
export type DocumentTypes = Record<string, { id: string }>;

// =============================================================================
// TypeRegistry — for module augmentation
// =============================================================================

/**
 * Module-augmentation registry. Consumers augment this once to tell the
 * library which `DocumentTypes` map (and, optionally, `QueryTypes` map) to use,
 * and every hook picks them up automatically without explicit generics at call
 * sites.
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
// oxlint-disable-next-line no-empty-interface
export interface TypeRegistry {}

/**
 * Resolved type map — reads from `TypeRegistry.types` if the consumer has
 * augmented it, falls back to the open `DocumentTypes` constraint otherwise.
 */
export type RegisteredTypes = TypeRegistry extends { types: infer T extends DocumentTypes }
  ? T
  : DocumentTypes;

// =============================================================================
// Handle regions — two orthogonal statechart regions
// =============================================================================

/**
 * Data region — what value, if any, the handle currently holds.
 *
 * - `Absent`  — nothing loaded yet.
 * - `Present` — a last-known-good `value` (kept across refetches, even failing
 *   ones, for stale-while-revalidate).
 */
export type DataState<T> =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Present"; readonly value: T; readonly fetchedAt: Date };

/**
 * Fetch region — what the most recent fetch is doing / how it settled.
 *
 * - `Idle`     — no fetch in flight.
 * - `Fetching` — a (re)fetch is in flight.
 * - `Failed`   — the most recent fetch failed, carrying the typed `error`.
 */
export type FetchState<E = SiloError> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Fetching" }
  | { readonly _tag: "Failed"; readonly error: E };

/**
 * Reactive handle for a single document — the product of two orthogonal
 * regions. `value` is in scope only once `data` is narrowed to `Present`;
 * `error` only once `fetch` is narrowed to `Failed`. The two regions vary
 * independently, so a stale `value` and a refetch `error` coexist rather than
 * clobbering each other.
 *
 * Backed by a single stable reactive object: `store.find("user", "1")` returns
 * the same handle every call, and reads of `data` / `fetch` subscribe per
 * region, so a component reading only `data` does not re-render when a
 * background refetch toggles `fetch`.
 *
 * @example
 * ```tsx
 * const u = useDocument("user", id);
 * if (u.data._tag === "Absent") {
 *   switch (u.fetch._tag) {
 *     case "Idle":     return null;
 *     case "Fetching": return <Spinner />;
 *     case "Failed":   return <ErrorPage e={u.fetch.error} />;
 *   }
 * }
 * return <Card user={u.data.value} busy={u.fetch._tag === "Fetching"} />;
 * ```
 */
export interface DocumentHandle<T, E = SiloError> {
  readonly data: DataState<T>;
  readonly fetch: FetchState<E>;
  /**
   * Stable Promise for use with React 19's `use()`. Present once a fetch has
   * started.
   *
   * - Resolves on first successful load (and is reused across refetches).
   * - If the first fetch errors, it rejects once.
   * - An `insertDocument` after a first-load error hands out a NEW resolved
   *   promise so a Suspense boundary inside an error boundary can recover.
   */
  readonly promise: Promise<T> | undefined;
}

// =============================================================================
// DocumentAdapter — consumer-owned transport (Effect-based)
// =============================================================================

/**
 * Talks to the API. Takes N ids and returns an `Effect` that produces a raw
 * response of whatever shape the API emits, failing with `AdapterError`. The
 * adapter owns *how* the data is fetched — bulk GET, N parallel GETs, a
 * websocket cycle, anything — typically by wrapping its transport in
 * `Effect.tryPromise`.
 *
 * The library doesn't inspect the raw value — only the paired
 * `ResponseProcessor` does.
 *
 * Contract:
 * - `find` receives a chunk of at most `DocumentStoreConfig.batchSize` ids,
 *   grouped by type and deduped (no duplicate ids in one call).
 * - A failed Effect fails every deferred waiting on that chunk.
 *
 * @example
 * ```ts
 * const userAdapter: DocumentAdapter = {
 *   find: (ids) =>
 *     Effect.tryPromise({
 *       try: () => fetch(`/users?ids=${ids.join(",")}`).then((r) => r.json()),
 *       catch: (cause) => new AdapterError({ type: "user", keys: ids, cause }),
 *     }),
 * };
 * ```
 */
export interface DocumentAdapter {
  find(ids: Array<string>): Effect.Effect<unknown, AdapterError>;
}

// =============================================================================
// ResponseProcessor — raw response → inserts
// =============================================================================

/**
 * Transforms a raw adapter response into store inserts. Calls
 * `store.insertDocument(type, doc)` for every document it wants cached (primary
 * + sideloaded). Returns nothing; the library looks up each requested
 * `(type, id)` via `store.findInMemory` afterward to settle the handle.
 *
 * Contract:
 * - Synchronous. For async normalization, do it in the adapter Effect.
 * - If it throws, every deferred on the chunk fails with a `ProcessorError`.
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
 * Per-model wiring: the adapter that talks to the API, an optional processor
 * that normalizes its response, and optional Effect-native resilience.
 *
 * If `processor` is omitted, the library uses `defaultProcessor`. `retry` and
 * `timeout` wrap the adapter Effect — a declarative win over hand-rolled
 * Promise retry loops.
 */
export interface ModelConfig<M extends DocumentTypes> {
  adapter: DocumentAdapter;
  processor?: ResponseProcessor<M>;
  /** Optional retry schedule applied to the adapter Effect on `AdapterError`. */
  retry?: Schedule.Schedule<unknown, AdapterError>;
  /** Optional timeout for the adapter Effect; a timeout becomes an `AdapterError`. */
  timeout?: Duration.DurationInput;
}

// =============================================================================
// DocumentStore config
// =============================================================================

export interface DocumentStoreConfig<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
> {
  /** Per-type adapter + optional processor wiring for documents. */
  models: { [K in keyof M]: ModelConfig<M> };
  /** Per-type adapter + optional processor wiring for queries. Optional. */
  queries?: { [K in keyof Q & string]: QueryConfig<M, Q, K> };
  /**
   * Batch-window duration in ms. `find` / `findQuery` calls within this window
   * collapse into their respective `adapter.find(...)` invocations. Default: 15.
   */
  batchWindowMs?: number;
  /**
   * Max keys per `adapter.find` call (documents and queries). Larger batches
   * are chunked. Default: 60.
   */
  batchSize?: number;
}

// =============================================================================
// DocumentStore — public store surface
// =============================================================================

/**
 * The public store surface. A plain object built by `createDocumentStore` and
 * mounted by the React Provider.
 */
export interface DocumentStore<
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

const IDLE_HANDLE: DocumentHandle<unknown> = Object.freeze({
  data: Object.freeze({ _tag: "Absent" as const }),
  fetch: Object.freeze({ _tag: "Idle" as const }),
  promise: undefined,
});

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function createDocumentStore<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
>(config: DocumentStoreConfig<M, Q>): DocumentStore<M, Q> {
  const finder = new Finder<M, Q>(config);
  const state = createReactive<InternalState>({
    documents: new Map(),
    queries: new Map(),
  }) as InternalState;

  const store: DocumentStore<M, Q> = {
    find<K extends keyof M & string>(type: K, id: string | null | undefined): DocumentHandle<M[K]> {
      if (id === null || id === undefined) return IDLE_HANDLE as DocumentHandle<M[K]>;

      const bucket = ensureBucket(state.documents, type);
      let handle = bucket.get(id);
      if (!handle) {
        bucket.set(id, makeIdleHandle());
        handle = bucket.get(id)!;
      }
      if (handle.data._tag === "Absent" && handle.fetch._tag === "Idle") {
        batch(() => applyEvent(handle!, HandleEvent.Fetch()));
        finder.queueDocument(type, id);
      }
      return handle as unknown as DocumentHandle<M[K]>;
    },

    findInMemory<K extends keyof M & string>(type: K, id: string): M[K] | undefined {
      const data = state.documents.get(type)?.get(id)?.data;
      return data?._tag === "Present" ? (data.value as M[K]) : undefined;
    },

    insertDocument<K extends keyof M & string>(type: K, doc: M[K]): void {
      // Freeze stored docs so the kernel's proxy preserves reference identity.
      if (!Object.isFrozen(doc)) Object.freeze(doc);

      batch(() => {
        const bucket = ensureBucket(state.documents, type);
        let handle = bucket.get(doc.id);
        if (!handle) {
          bucket.set(doc.id, makeIdleHandle());
          handle = bucket.get(doc.id)!;
        }
        applyEvent(handle, HandleEvent.Insert({ value: doc }));
      });
    },

    findQuery<K extends keyof Q & string>(
      type: K,
      params: Q[K]["params"] | null | undefined,
    ): QueryHandle<Q[K]["result"]> {
      if (params === null || params === undefined)
        return IDLE_HANDLE as QueryHandle<Q[K]["result"]>;

      const paramsKey = stableStringify(params);
      const bucket = ensureBucket(state.queries, type);
      let handle = bucket.get(paramsKey);
      if (!handle) {
        bucket.set(paramsKey, makeIdleHandle());
        // Re-read to get the reactive proxy reference; the raw pre-set value
        // would break handle identity for subsequent calls.
        handle = bucket.get(paramsKey)!;
      }
      if (handle.data._tag === "Absent" && handle.fetch._tag === "Idle") {
        batch(() => applyEvent(handle!, HandleEvent.Fetch()));
        finder.queueQuery(type, paramsKey, params);
      }
      return handle as unknown as QueryHandle<Q[K]["result"]>;
    },

    findQueryInMemory<K extends keyof Q & string>(
      type: K,
      params: Q[K]["params"],
    ): Q[K]["result"] | undefined {
      const paramsKey = stableStringify(params);
      const data = state.queries.get(type)?.get(paramsKey)?.data;
      return data?._tag === "Present" ? (data.value as Q[K]["result"]) : undefined;
    },

    insertQueryResult<K extends keyof Q & string>(
      type: K,
      params: Q[K]["params"],
      result: Q[K]["result"],
    ): void {
      if (result !== null && typeof result === "object" && !Object.isFrozen(result)) {
        Object.freeze(result);
      }

      const paramsKey = stableStringify(params);

      batch(() => {
        const bucket = ensureBucket(state.queries, type);
        let handle = bucket.get(paramsKey);
        if (!handle) {
          bucket.set(paramsKey, makeIdleHandle());
          handle = bucket.get(paramsKey)!;
        }
        applyEvent(handle, HandleEvent.Insert({ value: result }));
      });
    },

    clearMemory(): void {
      batch(() => {
        for (const bucket of state.documents.values()) {
          for (const handle of bucket.values()) applyEvent(handle, HandleEvent.Reset());
        }
        for (const bucket of state.queries.values()) {
          for (const handle of bucket.values()) applyEvent(handle, HandleEvent.Reset());
        }
      });
    },
  };

  finder.attach(state, store);
  return store;
}

// Re-export query handle types so `store.findQuery(...)` call sites don't need
// a second import path.
export type { QueryHandle };
