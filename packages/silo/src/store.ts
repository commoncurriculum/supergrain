import type { AdapterError, SiloError } from "./errors";
import type { QueryConfig, QueryHandle, QueryTypes } from "./queries";
import type { Duration, Effect, Schedule } from "effect";

import { batch, createReactive } from "@supergrain/kernel";

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
// Handle — flat, orthogonal fields
// =============================================================================

/**
 * Coarse lifecycle convenience, derived from the orthogonal fields:
 * - `success` — a `value` has loaded (even if a later refetch errored).
 * - `error`   — the first load failed and there is still no `value`.
 * - `pending` — no `value` and no first-load error yet.
 *
 * `status` never contradicts the fields and does not narrow `value`; branch on
 * `value` / `error` / `isFetching` directly when you need the full picture.
 */
export type HandleStatus = "pending" | "success" | "error";

/**
 * Stable Promise for use with React 19's `use()`. Present once a fetch has
 * started. Resolves on first successful load (reused across refetches);
 * rejects once if the first fetch errors; an `insertDocument` after a
 * first-load error hands out a NEW resolved promise so a Suspense boundary
 * nested in an error boundary can recover.
 */
type HandlePromise<T> = Promise<T> | undefined;

/**
 * Reactive handle for a single document — a `status`-discriminated union over
 * flat, orthogonal fields. Narrowing on `status` (or on `value !== undefined`)
 * refines `value` to `T`; `error` and `value` coexist in `success` so a stale
 * value and a fresh refetch error don't clobber each other.
 *
 * Backed by a single stable reactive object: `store.find("user", "1")` returns
 * the same handle every call, and each field is tracked independently — a
 * component reading only `value` does not re-render when a background refetch
 * toggles `isFetching`. `status` stays `"success"` across a refetch, so
 * narrowing on it doesn't add re-renders.
 *
 * @example
 * ```tsx
 * const u = useDocument("user", id);
 * if (u.status === "error") return <ErrorPage e={u.error} />;
 * if (u.status === "pending") return <Spinner />;
 * return <Card user={u.value} busy={u.isFetching} warn={u.error} />; // value: T
 * ```
 */
export type DocumentHandle<T, E = SiloError> =
  | {
      readonly status: "pending";
      readonly value: undefined;
      readonly error: undefined;
      readonly isFetching: boolean;
      readonly fetchedAt: undefined;
      readonly promise: HandlePromise<T>;
    }
  | {
      readonly status: "success";
      readonly value: T;
      /** A later refetch may have failed; the stale `value` is still here. */
      readonly error: E | undefined;
      readonly isFetching: boolean;
      readonly fetchedAt: Date;
      readonly promise: HandlePromise<T>;
    }
  | {
      readonly status: "error";
      readonly value: undefined;
      readonly error: E;
      readonly isFetching: boolean;
      readonly fetchedAt: undefined;
      readonly promise: HandlePromise<T>;
    };

// =============================================================================
// DocumentAdapter — consumer-owned transport (Effect-based)
// =============================================================================

/**
 * Talks to the API. Takes N ids and returns the raw response of whatever shape
 * the API emits. The adapter owns *how* the data is fetched — bulk GET, N
 * parallel GETs, a websocket cycle, anything.
 *
 * **Return a `Promise`** for the common case — the store runs it on its Effect
 * engine (batching, `retry`/`timeout`) for you, and a rejection becomes an
 * `AdapterError` automatically. Power users can **return an `Effect`** instead
 * to control the failure channel, compose their own retries, or manage
 * resources; it's used as-is. The library doesn't inspect the raw value — only
 * the paired `ResponseProcessor` does.
 *
 * Contract:
 * - `find` receives a chunk of at most `DocumentStoreConfig.batchSize` ids,
 *   grouped by type and deduped (no duplicate ids in one call).
 * - A rejected Promise / failed Effect fails every deferred waiting on that
 *   chunk (as an `AdapterError`).
 * - `ctx.signal` aborts when the adapter Effect is interrupted — e.g. a
 *   per-model `timeout` fires (or a `retry` abandons the prior attempt). Thread
 *   it into `fetch(url, { signal })` for a real network abort; ignore it and
 *   interruption simply discards the result.
 *
 * @example
 * ```ts
 * // Promise (the simple default):
 * const userAdapter: DocumentAdapter = {
 *   find: (ids, { signal } = {}) =>
 *     fetch(`/users?ids=${ids.join(",")}`, { signal }).then((r) => r.json()),
 * };
 *
 * // Effect (opt-in, for typed errors / custom retries / resources):
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
  find(
    ids: Array<string>,
    ctx?: { signal: AbortSignal },
  ): Promise<unknown> | Effect.Effect<unknown, AdapterError>;
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
  value: undefined,
  error: undefined,
  isFetching: false,
  fetchedAt: undefined,
  status: "pending" as const,
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

/**
 * Get the stable handle for `key`, creating an idle one on first access. The
 * re-read after `set` is deliberate: it returns the reactive proxy reference
 * (not the raw pre-set object), so `find`/`insert` hand out the same identity on
 * every call.
 */
function getOrCreateHandle(bucket: Map<string, InternalHandle>, key: string): InternalHandle {
  let handle = bucket.get(key);
  if (!handle) {
    bucket.set(key, makeIdleHandle());
    handle = bucket.get(key)!;
  }
  return handle;
}

/**
 * Resolve the handle for `key` in `bucket` and, if it's a never-loaded idle
 * handle (status "pending", no fetch in flight, no prior error), mark it
 * fetching and enqueue the request. Errored handles don't auto-retry; loaded
 * handles serve from cache. Shared by `find` and `findQuery` — the only
 * difference is which bucket and how the request is enqueued.
 */
function findOrFetch(
  bucket: Map<string, InternalHandle>,
  key: string,
  enqueue: () => void,
): InternalHandle {
  const handle = getOrCreateHandle(bucket, key);
  if (!handle.isFetching && handle.value === undefined && handle.error === undefined) {
    batch(() => applyEvent(handle, HandleEvent.fetch()));
    enqueue();
  }
  return handle;
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
      const handle = findOrFetch(ensureBucket(state.documents, type), id, () =>
        finder.queueDocument(type, id),
      );
      return handle as unknown as DocumentHandle<M[K]>;
    },

    findInMemory<K extends keyof M & string>(type: K, id: string): M[K] | undefined {
      return state.documents.get(type)?.get(id)?.value as M[K] | undefined;
    },

    insertDocument<K extends keyof M & string>(type: K, doc: M[K]): void {
      // Freeze stored docs so the kernel's proxy preserves reference identity.
      if (!Object.isFrozen(doc)) Object.freeze(doc);

      batch(() => {
        const handle = getOrCreateHandle(ensureBucket(state.documents, type), doc.id);
        applyEvent(handle, HandleEvent.insert(doc));
      });
    },

    findQuery<K extends keyof Q & string>(
      type: K,
      params: Q[K]["params"] | null | undefined,
    ): QueryHandle<Q[K]["result"]> {
      if (params === null || params === undefined)
        return IDLE_HANDLE as QueryHandle<Q[K]["result"]>;

      const paramsKey = stableStringify(params);
      const handle = findOrFetch(ensureBucket(state.queries, type), paramsKey, () =>
        finder.queueQuery(type, paramsKey, params),
      );
      return handle as unknown as QueryHandle<Q[K]["result"]>;
    },

    findQueryInMemory<K extends keyof Q & string>(
      type: K,
      params: Q[K]["params"],
    ): Q[K]["result"] | undefined {
      const paramsKey = stableStringify(params);
      return state.queries.get(type)?.get(paramsKey)?.value as Q[K]["result"] | undefined;
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
        const handle = getOrCreateHandle(ensureBucket(state.queries, type), paramsKey);
        applyEvent(handle, HandleEvent.insert(result));
      });
    },

    clearMemory(): void {
      batch(() => {
        for (const bucket of state.documents.values()) {
          for (const handle of bucket.values()) applyEvent(handle, HandleEvent.reset());
        }
        for (const bucket of state.queries.values()) {
          for (const handle of bucket.values()) applyEvent(handle, HandleEvent.reset());
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
