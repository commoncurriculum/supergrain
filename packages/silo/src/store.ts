import type { QueryConfig, QueryHandle, QueryTypes } from "./queries";

import { batch, createReactive, unwrap } from "@supergrain/kernel";
import { setProperty } from "@supergrain/kernel/internal";

import { Finder, type InternalHandle, type InternalState } from "./finder";

interface Resolvers<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

const NOOP_RESOLVE: (v: unknown) => void = () => {};
const NOOP_REJECT: (e: unknown) => void = () => {};

function withResolvers<T>(): Resolvers<T> {
  let resolve: (v: T) => void = NOOP_RESOLVE as (v: T) => void;
  let reject: (e: unknown) => void = NOOP_REJECT;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// =============================================================================
// Model types
// =============================================================================

/**
 * Consumer-defined map of type name → model shape.
 *
 * Each key is a type string (e.g. "user", "card-stack"), each value is the
 * full model type as defined by the consumer. The library doesn't impose
 * structure on the model beyond requiring an `id: string`. The type is
 * supplied externally at every API boundary (`find(type, id)`,
 * `insertDocument(type, doc)`), so nothing in the library reads the doc's
 * own `type` field — consumers whose API omits type from documents can
 * still use this library without modification.
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
 * library which `DocumentTypes` map (and, optionally, `QueryTypes` map) to
 * use, and every hook picks them up automatically without explicit generics
 * at call sites.
 *
 * @example
 * ```ts
 * // in app bootstrap, once:
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
 * `@supergrain/silo/processors/json-api` or a custom
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
// DocumentStore — public store surface returned by createDocumentStore
// =============================================================================

/**
 * The public store surface. A plain object, not a class: built by
 * `createDocumentStore(config)` and mounted by the React Provider.
 *
 * Consumers interact with the store exclusively through these methods.
 * Internal state (the reactive tree of nested document/query handles,
 * the Finder instance held in closure) is not part of this type.
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

/**
 * Create a plain document store object.
 *
 * This is the non-React primitive. React integrations wrap this via
 * `createDocumentStoreContext()`.
 */
const IDLE_HANDLE: DocumentHandle<unknown> = Object.freeze({
  status: "IDLE" as const,
  data: undefined,
  hasData: false,
  isPending: false,
  isFetching: false,
  fetchedAt: undefined,
  error: undefined,
  promise: undefined,
});

function makeIdleHandle(): InternalHandle {
  return {
    status: "IDLE",
    data: undefined,
    hasData: false,
    isPending: false,
    isFetching: false,
    fetchedAt: undefined,
    error: undefined,
    promise: undefined,
    resolve: undefined,
    reject: undefined,
  };
}

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

function resetHandle(handle: InternalHandle): void {
  if (handle.isFetching) {
    // Clear data but leave lifecycle alone — the in-flight fetch will
    // complete and re-populate normally.
    handle.data = undefined;
    handle.hasData = false;
    return;
  }
  handle.status = "IDLE";
  handle.data = undefined;
  handle.hasData = false;
  handle.isPending = false;
  handle.isFetching = false;
  handle.error = undefined;
  handle.promise = undefined;
  handle.fetchedAt = undefined;
}

function beginPendingHandle<T>(handle: InternalHandle<T>, resolvers: Resolvers<T>): void {
  handle.status = "PENDING";
  handle.isPending = true;
  handle.isFetching = true;
  handle.error = undefined;
  handle.promise = resolvers.promise;
  handle.resolve = resolvers.resolve;
  handle.reject = resolvers.reject;
}

function createSuccessHandle<T>(data: T): InternalHandle<T> {
  return {
    status: "SUCCESS",
    data,
    hasData: true,
    isPending: false,
    isFetching: false,
    fetchedAt: new Date(),
    error: undefined,
    promise: Promise.resolve(data),
    resolve: undefined,
    reject: undefined,
  };
}

function settleHandleWithData<T>(handle: InternalHandle<T>, data: T): void {
  handle.data = data;
  handle.hasData = true;

  if (handle.status === "PENDING") {
    handle.status = "SUCCESS";
    handle.isPending = false;
    handle.isFetching = false;
    handle.error = undefined;
    handle.fetchedAt = new Date();
    handle.resolve?.(data);
    handle.resolve = undefined;
    handle.reject = undefined;
  } else if (handle.status === "IDLE" || handle.status === "ERROR") {
    handle.status = "SUCCESS";
    handle.isPending = false;
    handle.isFetching = false;
    handle.error = undefined;
    handle.promise = Promise.resolve(data);
    handle.fetchedAt = new Date();
  }
}

function createStringKeyedRecord<T>(): Record<string, T> {
  return {};
}

function assertSafeRecordKey(key: string): void {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    throw new Error(`Unsafe cache key "${key}" is not allowed.`);
  }
}

function setOwnRecordValue<T>(record: Record<string, T>, key: string, value: T): void {
  assertSafeRecordKey(key);
  // Unwrap so the kernel proxy's `set` trap doesn't recurse into setProperty
  // and double-bump version/per-key signals on the same nodes.
  setProperty(unwrap(record), key, value);
}

function ensureHandleBucket<T>(
  buckets: Record<string, Record<string, InternalHandle<T>>>,
  type: string,
): Record<string, InternalHandle<T>> {
  // Check own-property on the raw target. Going through the proxy's
  // `getOwnPropertyDescriptor` trap calls `trackSelf`, which subscribes the
  // caller to `$OWN_KEYS` and forces a re-render whenever any sibling type
  // is added — that's the over-subscription consumers don't want.
  if (!Object.hasOwn(unwrap(buckets), type)) {
    setOwnRecordValue(buckets, type, createStringKeyedRecord<InternalHandle<T>>());
  }
  return buckets[type]!;
}

function ensureHandle<T>(
  buckets: Record<string, Record<string, InternalHandle<T>>>,
  type: string,
  key: string,
): InternalHandle<T> {
  const bucket = ensureHandleBucket(buckets, type);
  if (!Object.hasOwn(unwrap(bucket), key)) {
    setOwnRecordValue(bucket, key, makeIdleHandle() as InternalHandle<T>);
  }
  return bucket[key]!;
}

export function createDocumentStore<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
>(config: DocumentStoreConfig<M, Q>): DocumentStore<M, Q> {
  const finder = new Finder<M, Q>(config);
  // Strip the `Branded<T>` marker from the reactive proxy's type so indexed
  // writes (`state.documents[type] = {...}`) compile. The runtime proxy
  // behavior is identical; the brand is purely a compile-time identification
  // token that otherwise blocks direct assignment into nested generics.
  const state = createReactive<InternalState>({
    documents: createStringKeyedRecord(),
    queries: createStringKeyedRecord(),
  }) as InternalState;

  function kickOffDocumentFetch(type: keyof M & string, id: string): void {
    const { promise, resolve, reject } = withResolvers<unknown>();
    // Suppress unhandled-rejection warnings without affecting user's ability
    // to observe the rejection via `await handle.promise`.
    promise.catch(() => {});
    batch(() => {
      beginPendingHandle(state.documents[type]![id]!, { promise, resolve, reject });
    });
    finder.queueDocument(type, id);
  }

  function kickOffQueryFetch(
    type: keyof Q & string,
    paramsKey: string,
    params: Q[keyof Q & string]["params"],
  ): void {
    const { promise, resolve, reject } = withResolvers<unknown>();
    promise.catch(() => {});
    batch(() => {
      beginPendingHandle(state.queries[type]![paramsKey]!, { promise, resolve, reject });
    });
    finder.queueQuery(type, paramsKey, params);
  }

  const store: DocumentStore<M, Q> = {
    find<K extends keyof M & string>(type: K, id: string | null | undefined): DocumentHandle<M[K]> {
      if (id === null || id === undefined) return IDLE_HANDLE as DocumentHandle<M[K]>;

      const handle = ensureHandle(
        state.documents as Record<string, Record<string, InternalHandle<M[K]>>>,
        type,
        id,
      );
      if (handle.status === "IDLE") {
        kickOffDocumentFetch(type, id);
      }
      return handle as unknown as DocumentHandle<M[K]>;
    },

    findInMemory<K extends keyof M & string>(type: K, id: string): M[K] | undefined {
      return state.documents[type]?.[id]?.data as M[K] | undefined;
    },

    insertDocument<K extends keyof M & string>(type: K, doc: M[K]): void {
      // Freeze stored docs so the kernel's proxy `get` trap returns them
      // as-is (createReactiveProxy short-circuits on frozen targets),
      // preserving reference identity for consumers that compare handle.data
      // to the doc they inserted.
      if (!Object.isFrozen(doc)) Object.freeze(doc);

      batch(() => {
        const bucket = ensureHandleBucket(
          state.documents as Record<string, Record<string, InternalHandle<M[K]>>>,
          type,
        );

        if (!Object.hasOwn(unwrap(bucket), doc.id)) {
          setOwnRecordValue(bucket, doc.id, createSuccessHandle(doc));
          return;
        }

        settleHandleWithData(bucket[doc.id]!, doc);
        // SUCCESS: only `data` + `hasData` update — promise reference stays stable.
      });
    },

    findQuery<K extends keyof Q & string>(
      type: K,
      params: Q[K]["params"] | null | undefined,
    ): QueryHandle<Q[K]["result"]> {
      if (params === null || params === undefined)
        return IDLE_HANDLE as QueryHandle<Q[K]["result"]>;

      const paramsKey = stableStringify(params);
      const handle = ensureHandle(
        state.queries as Record<string, Record<string, InternalHandle<Q[K]["result"]>>>,
        type,
        paramsKey,
      );
      if (handle.status === "IDLE") {
        kickOffQueryFetch(type, paramsKey, params);
      }
      return handle as unknown as QueryHandle<Q[K]["result"]>;
    },

    findQueryInMemory<K extends keyof Q & string>(
      type: K,
      params: Q[K]["params"],
    ): Q[K]["result"] | undefined {
      const paramsKey = stableStringify(params);
      return state.queries[type]?.[paramsKey]?.data as Q[K]["result"] | undefined;
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
        const bucket = ensureHandleBucket(
          state.queries as Record<string, Record<string, InternalHandle<Q[K]["result"]>>>,
          type,
        );

        if (!Object.hasOwn(unwrap(bucket), paramsKey)) {
          setOwnRecordValue(bucket, paramsKey, createSuccessHandle(result));
          return;
        }

        settleHandleWithData(bucket[paramsKey]!, result);
      });
    },

    clearMemory(): void {
      batch(() => {
        for (const typeKey of Object.keys(state.documents)) {
          const bucket = state.documents[typeKey];
          if (bucket) {
            for (const id of Object.keys(bucket)) resetHandle(bucket[id]!);
          }
        }
        for (const typeKey of Object.keys(state.queries)) {
          const bucket = state.queries[typeKey];
          if (bucket) {
            for (const paramsKey of Object.keys(bucket)) resetHandle(bucket[paramsKey]!);
          }
        }
      });
    },
  };

  finder.attach(state, store);
  return store;
}

// Re-export query handle types so `store.findQuery(...)` call sites don't
// need a second import path. QueryHandle is defined in
// ./queries; this pass-through keeps the public surface single-origin.
export type { QueryHandle };
