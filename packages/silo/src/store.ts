import type { StoreHooks } from "./hooks";
import type { QueryConfig, QueryHandle, QueryTypes } from "./queries";
import type { Effect } from "effect";

import { batch, createReactive, unwrap } from "@supergrain/kernel";

import { attachSiloDevtools } from "./devtools";
import { type AdapterError, ProcessorError, type SiloError } from "./errors";
import { Finder } from "./finder";
import { createLoadedLists } from "./loaded-lists";
import {
  type AdapterErrorSink,
  type AdapterOptionOverrides,
  emitToSink,
  type ResilienceOptions,
  resolveAdapterOptions,
  type ResolvedAdapterOptions,
} from "./resolve";
import { type AdapterFailureInfo, runAdapter } from "./run-adapter";
import {
  combineDocumentsTogether,
  type DocumentsTogetherHandle,
  IDLE_DOCUMENTS_TOGETHER_HANDLE,
} from "./together";
import { applyEvent, HandleEvent, type InternalHandle, makeIdleHandle } from "./transitions";
import { stableStringify } from "./util";

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

/**
 * Map of type name → model shape. Models need only an `id: string`.
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

export type { StoreHooks } from "./hooks";

/**
 * Augment once to declare your `types` (and optional `queries`) map, so hooks
 * need no explicit generics.
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

/** `TypeRegistry.types` if declared, else `DocumentTypes`. */
export type RegisteredTypes = TypeRegistry extends { types: infer T extends DocumentTypes }
  ? T
  : DocumentTypes;

/**
 * - `success` — a `value` has loaded (even if a later refetch errored).
 * - `error`   — the first load failed and there is still no `value`.
 * - `pending` — no `value` and no first-load error yet.
 */
export type HandleStatus = "pending" | "success" | "error";

/**
 * Stable promise for React's `use()`, present once a fetch has started.
 * Resolves on the first load and is reused across refetches; rejects if the
 * first fetch fails. An `insertDocument` after that failure hands out a new
 * resolved promise so an error boundary can recover.
 */
export type HandlePromise<T> = Promise<T> | undefined;

/**
 * Reactive handle for one document. Narrowing on `status` (or
 * `value !== undefined`) refines `value`. `find` returns the same handle every
 * call, and each field is tracked separately.
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
      /** Failed attempts in the current fetch cycle. */
      readonly failureCount: number;
      /** The latest attempt's error, set while still retrying. */
      readonly lastError: E | undefined;
      readonly promise: HandlePromise<T>;
    }
  | {
      readonly status: "success";
      readonly value: T;
      /** A later refetch may have failed; the stale `value` is still here. */
      readonly error: E | undefined;
      readonly isFetching: boolean;
      readonly fetchedAt: Date;
      readonly failureCount: number;
      readonly lastError: E | undefined;
      readonly promise: HandlePromise<T>;
    }
  | {
      readonly status: "error";
      readonly value: undefined;
      readonly error: E;
      readonly isFetching: boolean;
      readonly fetchedAt: undefined;
      readonly failureCount: number;
      readonly lastError: E | undefined;
      readonly promise: HandlePromise<T>;
    };

/**
 * Fetches documents by id. Gets a deduped chunk of at most `batchSize` ids of
 * one type and returns the raw response for the model's processors. Return a
 * `Promise` (a rejection becomes an `AdapterError`) or an `Effect`. A failure
 * fails every request in the chunk. `ctx.signal` aborts when the attempt is
 * interrupted (a `timeout`, or a retry abandoning it).
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
    ctx?: { signal?: AbortSignal },
  ): Promise<unknown> | Effect.Effect<unknown, AdapterError>;
}

/** Context handed to every {@link ResponseProcessor}. */
export interface ProcessorContext<M extends DocumentTypes> {
  readonly store: DocumentStore<M>;
  readonly type: keyof M & string;
  readonly ids: ReadonlyArray<string>;
}

/**
 * One step in a model's response pipeline. Returning a value replaces the
 * response for the next step; `undefined` / `null` passes it on. Documents are
 * cached only when a step calls `store.insertDocument`; each requested id is
 * then looked up to settle its handle.
 *
 * - Synchronous; do async work in the adapter.
 * - A throw stops the pipeline and fails the chunk with a `ProcessorError`.
 *
 * @example
 * ```ts
 * const normalize: ResponseProcessor<M> = (response) => {
 *   for (const doc of responseDocs(response)) migrateInPlace(doc);
 *   return response;
 * };
 *
 * const insert: ResponseProcessor<M> = (response, { store, type }) => {
 *   for (const doc of responseDocs(response)) store.insertDocument(type, doc);
 * };
 * ```
 */
export type ResponseProcessor<M extends DocumentTypes> = (
  response: unknown,
  context: ProcessorContext<M>,
) => unknown | void;

/**
 * Per-model adapter and response pipeline. Set `processor` or `processors`,
 * not both (that throws at store creation); with neither, `defaultProcessor`
 * is used. Resilience options override the store's.
 */
export interface ModelConfig<M extends DocumentTypes> extends ResilienceOptions {
  adapter: DocumentAdapter;
  processor?: ResponseProcessor<M>;
  processors?: ReadonlyArray<ResponseProcessor<M>>;
  /**
   * What a new version of a stored document does: `"patch"` (default) writes
   * only the changed fields into the stored document; `"replace"` swaps in the
   * new object.
   */
  onRefetch?: "patch" | "replace";
}

/**
 * Store-wide configuration. Resilience options here are defaults for every
 * fetch that doesn't set its own; unset, `retry` is `defaultRetry` and
 * `deadline` is `defaultDeadline`.
 */
export interface DocumentStoreConfig<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
> extends ResilienceOptions {
  models: { [K in keyof M]: ModelConfig<M> };
  queries?: { [K in keyof Q & string]: QueryConfig<M, Q, K> };
  hooks?: StoreHooks<M>;
  /** Calls within this many ms share one `adapter.find` per type. Default: 15. */
  batchWindowMs?: number;
  /** Max keys per `adapter.find` call. Default: 60. */
  batchSize?: number;
  /**
   * Max concurrent adapter attempts across the store, including
   * `store.runAdapter` callers. A positive integer or `"unbounded"` (default).
   * A slot is released during retry backoff.
   */
  maxConcurrency?: number | "unbounded";
  /**
   * Called on every failed attempt, on terminal `NotFoundError` /
   * `ProcessorError`, and when `afterInsert` throws (as a `ProcessorError`).
   * Errors it throws are swallowed.
   */
  onError?: AdapterErrorSink;
}

export interface DocumentStore<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
> {
  find<K extends keyof M & string>(type: K, id: string | null | undefined): DocumentHandle<M[K]>;
  /**
   * One independent handle per id, in id order. `null` / `undefined` ids give
   * `[]`. Returns a new array each call.
   */
  findDocumentsIndividually<K extends keyof M & string>(
    type: K,
    ids: string[] | null | undefined,
  ): Array<DocumentHandle<M[K]>>;
  /**
   * One all-or-nothing handle for the batch. `null` / `undefined` ids give an
   * idle handle; `[]` is immediately `success`.
   */
  findDocumentsTogether<K extends keyof M & string>(
    type: K,
    ids: string[] | null | undefined,
  ): DocumentsTogetherHandle<M[K]>;
  findInMemory<K extends keyof M & string>(type: K, id: string): M[K] | undefined;
  /**
   * The loaded documents of one type, in first-load order. Never fetches.
   * Returns the same reactive array every call, so `computedList` over it
   * updates without rescanning.
   */
  findAllInMemory<K extends keyof M & string>(type: K): ReadonlyArray<M[K]>;
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
  /** Merge per-call overrides over the store's resilience options and built-in defaults. */
  resolveAdapterOptions(perCall?: AdapterOptionOverrides): ResolvedAdapterOptions;
  /**
   * Run one adapter call with the store's resilience options, `onError` sink,
   * and `maxConcurrency` cap. For layered packages.
   */
  runAdapter<A>(
    invoke: (ctx: { signal: AbortSignal }) => Promise<A> | Effect.Effect<A, AdapterError>,
    options: StoreAdapterRunOptions,
  ): Effect.Effect<A, AdapterError>;
}

/** Options for {@link DocumentStore.runAdapter}. */
export interface StoreAdapterRunOptions extends AdapterOptionOverrides {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  /**
   * Called for each failed attempt and a `deadline` breach, after `onError`.
   * Throws are swallowed.
   */
  readonly onFailure?: (error: AdapterError, info: AdapterFailureInfo) => void;
}

export const IDLE_HANDLE: DocumentHandle<unknown> = Object.freeze({
  value: undefined,
  error: undefined,
  isFetching: false,
  fetchedAt: undefined,
  failureCount: 0,
  lastError: undefined,
  status: "pending" as const,
  promise: undefined,
});

// Re-read after `set` to get the reactive proxy, not the raw object.
function getOrCreateHandle(bucket: Map<string, InternalHandle>, key: string): InternalHandle {
  let handle = bucket.get(key);
  if (!handle) {
    bucket.set(key, makeIdleHandle());
    handle = bucket.get(key)!;
  }
  return handle;
}

// Read raw so a tracked caller isn't subscribed to `isFetching` / `error`.
function needsFetch(handle: InternalHandle): boolean {
  const raw = unwrap(handle);
  return !raw.isFetching && raw.value === undefined && raw.error === undefined;
}

export function createDocumentStore<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
>(config: DocumentStoreConfig<M, Q>): DocumentStore<M, Q> {
  const state = createReactive<InternalState>({
    documents: new Map(),
    queries: new Map(),
  }) as InternalState;
  const finder = new Finder<M, Q>(config, state);
  const loaded = createLoadedLists((type) => unwrap(state.documents).get(type));

  const store: DocumentStore<M, Q> = {
    find<K extends keyof M & string>(type: K, id: string | null | undefined): DocumentHandle<M[K]> {
      if (id === null || id === undefined) return IDLE_HANDLE as DocumentHandle<M[K]>;
      const handle = getOrCreateHandle(ensureBucket(state.documents, type), id);
      if (needsFetch(handle)) {
        // Checked only here so cached sideloads of unconfigured types stay readable.
        if (config.models[type] === undefined) {
          throw new Error(
            `@supergrain/silo: no model "${type}" is configured — add it to DocumentStoreConfig.models`,
          );
        }
        batch(() => applyEvent(handle, HandleEvent.fetch()));
        finder.queueDocument(type, id);
      }
      return handle as unknown as DocumentHandle<M[K]>;
    },

    findDocumentsIndividually<K extends keyof M & string>(
      type: K,
      ids: string[] | null | undefined,
    ): Array<DocumentHandle<M[K]>> {
      if (ids === null || ids === undefined) return [];
      // oxlint-disable-next-line no-array-method-this-argument -- DocumentStore#find, not Array#find
      return batch(() => ids.map((id) => store.find(type, id)));
    },

    findDocumentsTogether<K extends keyof M & string>(
      type: K,
      ids: string[] | null | undefined,
    ): DocumentsTogetherHandle<M[K]> {
      if (ids === null || ids === undefined) return IDLE_DOCUMENTS_TOGETHER_HANDLE;
      // oxlint-disable-next-line no-array-method-this-argument -- DocumentStore#find, not Array#find
      const handles = batch(() => ids.map((id) => store.find(type, id)));
      return combineDocumentsTogether(handles);
    },

    findInMemory<K extends keyof M & string>(type: K, id: string): M[K] | undefined {
      return state.documents.get(type)?.get(id)?.value as M[K] | undefined;
    },

    findAllInMemory<K extends keyof M & string>(type: K): ReadonlyArray<M[K]> {
      return loaded.get(type) as ReadonlyArray<M[K]>;
    },

    insertDocument<K extends keyof M & string>(type: K, doc: M[K]): void {
      // Never freeze stored docs: the kernel returns a frozen object unwrapped,
      // losing per-field reactivity. `prepareInsert` runs before wrapping so its
      // in-place edits don't notify.
      const prepareInsert = config.hooks?.prepareInsert;
      let prepared: M[K] = doc;
      if (prepareInsert) {
        const result = prepareInsert(type, doc);
        if (result === null) return;
        prepared = result ?? doc;
      }
      const stored = batch(() => {
        const handle = getOrCreateHandle(ensureBucket(state.documents, type), prepared.id);
        const before = unwrap(handle).value;
        applyEvent(handle, HandleEvent.insert(prepared, config.models[type]?.onRefetch));
        const after = unwrap(handle).value;
        loaded.changed(type, prepared.id, before, after);
        return after as M[K];
      });
      // A throwing observer must not fail sibling docs in the same fetch.
      const afterInsert = config.hooks?.afterInsert;
      if (afterInsert) {
        try {
          afterInsert(type, stored);
        } catch (error) {
          emitToSink(config.onError, new ProcessorError({ type, cause: error }), {
            type,
            keys: [prepared.id],
            attempt: 1,
            retryable: false,
          });
        }
      }
    },

    findQuery<K extends keyof Q & string>(
      type: K,
      params: Q[K]["params"] | null | undefined,
    ): QueryHandle<Q[K]["result"]> {
      // Before validation, so `findQuery(type, ready ? params : null)` works for
      // an unconfigured type.
      if (params === null || params === undefined)
        return IDLE_HANDLE as QueryHandle<Q[K]["result"]>;

      const paramsKey = stableStringify(params);
      const handle = getOrCreateHandle(ensureBucket(state.queries, type), paramsKey);
      if (needsFetch(handle)) {
        // Checked only here so seeded results of unconfigured types stay readable.
        if (config.queries?.[type] === undefined) {
          throw new Error(
            `@supergrain/silo: no query "${type}" is configured — add it to DocumentStoreConfig.queries`,
          );
        }
        batch(() => applyEvent(handle, HandleEvent.fetch()));
        finder.queueQuery(type, paramsKey, params);
      }
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
      const paramsKey = stableStringify(params);
      batch(() => {
        const handle = getOrCreateHandle(ensureBucket(state.queries, type), paramsKey);
        applyEvent(handle, HandleEvent.insert(result, config.queries?.[type]?.onRefetch));
      });
    },

    clearMemory(): void {
      batch(() => {
        for (const bucket of state.documents.values()) {
          for (const handle of bucket.values()) applyEvent(handle, HandleEvent.reset());
        }
        loaded.clear();
        for (const bucket of state.queries.values()) {
          for (const handle of bucket.values()) applyEvent(handle, HandleEvent.reset());
        }
      });
    },

    resolveAdapterOptions(perCall?: AdapterOptionOverrides): ResolvedAdapterOptions {
      return resolveAdapterOptions(config, perCall);
    },

    runAdapter<A>(
      invoke: (ctx: { signal: AbortSignal }) => Promise<A> | Effect.Effect<A, AdapterError>,
      options: StoreAdapterRunOptions,
    ): Effect.Effect<A, AdapterError> {
      const { type, keys, onFailure, ...overrides } = options;
      const resolved = resolveAdapterOptions(config, overrides);
      return runAdapter(invoke, {
        type,
        keys,
        retry: resolved.retry,
        timeout: resolved.timeout,
        deadline: resolved.deadline,
        retryable: resolved.retryable,
        permits: finder.permits,
        onFailure: (error, info) => {
          emitToSink(config.onError, error, {
            type,
            keys,
            attempt: info.attempt,
            retryable: info.retryable,
          });
          onFailure?.(error, info);
        },
      });
    },
  };

  finder.attach(store);

  attachSiloDevtools(store, {
    state,
    documentTypes: Object.keys(config.models),
    queryTypes: Object.keys(config.queries ?? {}),
    clearMemory: () => store.clearMemory(),
  });

  return store;
}

export type { QueryHandle };
