import type { StoreHooks } from "./hooks";
import type { QueryConfig, QueryHandle, QueryTypes } from "./queries";
import type { Effect } from "effect";

import { batch, createReactive, unwrap } from "@supergrain/kernel";

import { attachSiloDevtools } from "./devtools";
import { type AdapterError, ProcessorError, type SiloError } from "./errors";
import { Finder } from "./finder";
import {
  type AdapterErrorSink,
  type AdapterOptionOverrides,
  emitToSink,
  type ResilienceOptions,
  resolveAdapterOptions,
  type ResolvedAdapterOptions,
} from "./resolve";
import { type AdapterFailureInfo, runAdapter } from "./run-adapter";
import { applyEvent, HandleEvent, type InternalHandle, makeIdleHandle } from "./transitions";
import { arrayEqual } from "./util";

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

// Store-wide lifecycle hooks live in their own module; re-exported here so the
// public surface (`import { StoreHooks } from "@supergrain/silo"`) is unchanged.
export type { StoreHooks } from "./hooks";

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
      /** Failed attempts in the current fetch cycle (0 until one fails). */
      readonly failureCount: number;
      /** The latest attempt's error while retrying — visible before the fetch gives up. */
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
 * Reactive handle for an array of documents queried by ids (for the same type).
 * Wraps the individual `DocumentHandle<T>` objects and provides aggregates over them.
 *
 * The "strict" aggregates treat an error in any value as an overall error.
 * The other aggregates filter out errored values while respecting the original id order.
 *
 * The handle is **not** stable across calls to `store.findAll` with the same arguments.
 * However, it is stable across calls to `useDocuments` with the same arguments;
 * reads to individual fields trigger reactive reads of the corresponding fields on
 * the individual handles. Changing the input ids always results in a fresh object.
 */
export interface DocumentsHandle<T, E = SiloError> {
  /** Handles for each value, in the same order as the queried ids. */
  readonly handles: Array<DocumentHandle<T, E>>;
  /**
   * All current successful values, in the same order as the queried
   * ids but omitting pending/errored values.
   *
   * Empty if no ids were provided.
   */
  readonly values: Array<T>;
  /**
   * The aggregate status of the non-errored values: "success" if they all succeeded,
   * "pending" if some are still pending.
   */
  readonly status: "pending" | "success";
  /**
   * The aggregate status: "success" if they all succeeded, "pending" if some
   * are still pending, "error" if there are any errors.
   */
  readonly statusStrict: "pending" | "success" | "error";
  /**
   * The combination of the handle promises.
   *
   * Resolves once no values are pending, containing only the values that succeeded.
   */
  readonly promise: HandlePromise<Array<T>>;
  /**
   * The combination of the handle promises.
   *
   * Resolves with all values, or rejects if any value errors.
   */
  readonly promiseStrict: HandlePromise<Array<T>>;
}

class DocumentsHandleImpl<T, E = SiloError> implements DocumentsHandle<T, E> {
  constructor(readonly handles: Array<DocumentHandle<T, E>>) {}

  // Use getters so that reads are reactive via the handles.
  // Cache aggregates so that we can return stable references when the
  // aggregated content hasn't changed.

  _cachedValues: Array<T> = [];
  get values() {
    const values = this.handles
      .filter((handle) => handle.status === "success")
      .map((handle) => handle.value);

    if (arrayEqual(values, this._cachedValues)) {
      // The values themselves did not change.
      // Return the same array.
      return this._cachedValues;
    }
    this._cachedValues = values;
    return values;
  }

  get status() {
    return this.handles.some((handle) => handle.status === "pending") ? "pending" : "success";
  }

  get statusStrict(): "pending" | "success" | "error" {
    // Promise.all semantics: an error is terminal (short-circuits even while
    // others are still pending), so it wins over pending, which wins over
    // success. Reading `handle.status` (not `handle.error`) means a stale
    // success whose refetch errored still counts as success — its first-load
    // promise already resolved, so `promiseStrict` won't reject on it.
    let hasPending = false;
    for (const handle of this.handles) {
      if (handle.status === "error") return "error";
      if (handle.status === "pending") hasPending = true;
    }
    return hasPending ? "pending" : "success";
  }

  // The combined promises are cached against the array of underlying
  // `handle.promise` references. Reading each `handle.promise` subscribes the
  // caller reactively, and a refetch/insert that swaps a handle's promise
  // rebuilds the combination — otherwise the same identity is returned so
  // React's `use()` doesn't re-suspend every render. All-idle
  // handles have no in-flight work, so there is no promise to hand out yet.

  _cachedPromiseInputs: Array<Promise<T> | undefined> = [];
  _cachedPromise: HandlePromise<Array<T>> = undefined;
  get promise(): HandlePromise<Array<T>> {
    const inputs = this.handles.map((handle) => handle.promise);
    if (inputs.length > 0 && inputs.every((promise) => promise === undefined)) return undefined;
    if (this._cachedPromise !== undefined && arrayEqual(inputs, this._cachedPromiseInputs)) {
      return this._cachedPromise;
    }
    this._cachedPromiseInputs = inputs;
    // Wait for every handle to settle (allSettled never rejects), then snapshot
    // the values that ended up successful — read at settle time so an in-place
    // or wholesale update after the promise resolved isn't served stale.
    this._cachedPromise = Promise.allSettled(
      inputs.map((promise) => promise ?? Promise.resolve()),
    ).then(() =>
      this.handles.filter((handle) => handle.status === "success").map((handle) => handle.value),
    );
    return this._cachedPromise;
  }

  _cachedPromiseStrictInputs: Array<Promise<T> | undefined> = [];
  _cachedPromiseStrict: HandlePromise<Array<T>> = undefined;
  get promiseStrict(): HandlePromise<Array<T>> {
    const inputs = this.handles.map((handle) => handle.promise);
    if (inputs.length > 0 && inputs.every((promise) => promise === undefined)) return undefined;
    if (
      this._cachedPromiseStrict !== undefined &&
      arrayEqual(inputs, this._cachedPromiseStrictInputs)
    ) {
      return this._cachedPromiseStrict;
    }
    this._cachedPromiseStrictInputs = inputs;
    // Promise.all rejects as soon as any handle errors (even while others are
    // pending); once it fulfils every handle is a success, so snapshot them all.
    const promise = Promise.all(inputs.map((promise) => promise ?? Promise.resolve())).then(() =>
      this.handles.map((handle) => handle.value as T),
    );
    // Suppress unhandled-rejection warnings at the source; consumers still
    // observe the rejection by awaiting the promise (or via `use()`).
    promise.catch(() => {});
    this._cachedPromiseStrict = promise;
    return promise;
  }
}

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
 * the model's configured `ResponseProcessor`(s) do.
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
    ctx?: { signal?: AbortSignal },
  ): Promise<unknown> | Effect.Effect<unknown, AdapterError>;
}

// =============================================================================
// ResponseProcessor — ordered response pipeline step
// =============================================================================

/**
 * Context handed to every {@link ResponseProcessor} in a model's pipeline: the
 * `store` (to read cached docs and insert new ones), the `type` the caller
 * passed to `find(type, id)`, and the chunk's requested `ids`.
 */
export interface ProcessorContext<M extends DocumentTypes> {
  /** The store — read with `findInMemory`, write with `insertDocument`. */
  readonly store: DocumentStore<M>;
  /** The type the caller passed to `find(type, id)` for this chunk. */
  readonly type: keyof M & string;
  /** The document ids this chunk fetched. */
  readonly ids: ReadonlyArray<string>;
}

/**
 * One step in a model's ordered response pipeline.
 *
 * The adapter returns a response. Silo passes that response through each
 * processor in order. A processor may **mutate** the response, **return a
 * replacement** response, perform **side effects**, or **insert documents**
 * into the store. If it returns `undefined` (or `null`), the current response
 * continues unchanged to the next processor. Most pipelines end with an
 * insertion processor that calls `store.insertDocument(type, doc)` for every
 * document worth caching; the library then looks up each requested
 * `(type, id)` via `store.findInMemory` to settle the handle.
 *
 * Contract:
 * - Synchronous. For async normalization, do it in the adapter Effect.
 * - If it throws, the remaining processors do not run and every deferred on
 *   the chunk fails with a `ProcessorError` (its `cause` is the thrown error).
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

// =============================================================================
// Per-model config
// =============================================================================

/**
 * Per-model wiring: the adapter that talks to the API, the response
 * processor(s) that turn its response into store inserts, and optional
 * Effect-native resilience.
 *
 * Responses run through an **ordered pipeline**. Configure it either way:
 * - `processor` — a single {@link ResponseProcessor} (normalized to a
 *   one-element pipeline).
 * - `processors` — an ordered array of {@link ResponseProcessor}s, run in
 *   declared order.
 *
 * Supply at most one. Setting **both** is a configuration error and throws at
 * store creation — the intent is ambiguous. If neither is supplied, the
 * library uses `defaultProcessor` (so `{ adapter }`,
 * `{ adapter, processor: defaultProcessor }`, and
 * `{ adapter, processors: [defaultProcessor] }` are equivalent).
 *
 * The inherited resilience knobs ({@link ResilienceOptions}: `retry` /
 * `timeout` / `deadline` / `retryable` / `isolateFailures`) override the
 * store-wide defaults for this model — resolution precedence is per-model →
 * store-wide → built-in `defaultRetry`.
 */
export interface ModelConfig<M extends DocumentTypes> extends ResilienceOptions {
  adapter: DocumentAdapter;
  /** A single response processor. Mutually exclusive with `processors`. */
  processor?: ResponseProcessor<M>;
  /**
   * An ordered response pipeline, run in declared order. Mutually exclusive
   * with `processor`.
   */
  processors?: ReadonlyArray<ResponseProcessor<M>>;
}

// =============================================================================
// DocumentStore config
// =============================================================================

/**
 * Store-wide configuration. The inherited resilience knobs
 * ({@link ResilienceOptions}: `retry` / `timeout` / `deadline` / `retryable` /
 * `isolateFailures`) are **defaults for every document and query fetch** that
 * doesn't set its own (per-model / per-query). `retry` falls back to the
 * built-in {@link defaultRetry} (fibonacci 1s–60s) — disable with
 * `Schedule.recurs(0)` or bound it with e.g. `Schedule.recurs(3)`. `deadline`
 * falls back to the built-in `defaultDeadline` (2 minutes), so a fetch always
 * settles eventually — opt out with `Duration.infinity`. `timeout` /
 * `retryable` are off unless configured.
 */
export interface DocumentStoreConfig<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
> extends ResilienceOptions {
  /** Per-type adapter + optional response-processor pipeline for documents. */
  models: { [K in keyof M]: ModelConfig<M> };
  /** Per-type adapter + optional processor wiring for queries. Optional. */
  queries?: { [K in keyof Q & string]: QueryConfig<M, Q, K> };
  /**
   * Store-wide lifecycle hooks — `prepareInsert` / `afterInsert`, bracketing
   * every `insertDocument`. Parallel to `models` / `queries`. See
   * {@link StoreHooks}.
   */
  hooks?: StoreHooks<M>;
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
  /**
   * Max concurrent `adapter.find` **attempts** across the store. A large
   * render (thousands of ids → many chunks) otherwise fires every chunk at
   * once. `"unbounded"` (default) preserves that; set a positive integer to
   * cap simultaneous adapter calls and avoid a self-inflicted thundering
   * herd (anything below 1 is rejected at store creation — a zero-permit
   * semaphore would block every fetch forever). The bound is a per-attempt
   * semaphore: it composes across batch windows and `isolateFailures`
   * bisection, and a chunk sleeping between retries releases its slot, so
   * failing chunks never starve healthy ones.
   */
  maxConcurrency?: number | "unbounded";
  /**
   * Optional error sink — called on **every failed attempt** (so a retrying
   * fetch isn't silent) and on a terminal `NotFoundError` / `ProcessorError`,
   * with the failing `type` / `keys`, the 1-based `attempt`, and whether the
   * failure was `retryable`. Fires for document fetches, `findQuery` fetches,
   * and `@supergrain/queries` fetches alike — plus an isolated `afterInsert`
   * hook throw (reported as a `ProcessorError`). For logging / metrics; a
   * throwing callback never affects the store.
   */
  onError?: AdapterErrorSink;
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
  /**
   * Find many documents of one type by id, returning a {@link DocumentsHandle}
   * aggregate over the individual (stable, reactive) handles — each fetched via
   * `find`, in id order. A `null` / `undefined` `ids` yields an idle
   * aggregate; empty `ids` returns a successful aggregate with no values.
   * The returned object is **not** stable across calls; the handles
   * inside it are (`find` is idempotent). `useDocuments` layers stability on top.
   */
  findAll<K extends keyof M & string>(
    type: K,
    ids: string[] | null | undefined,
  ): DocumentsHandle<M[K]>;
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
  /**
   * Resolve the resilience options for one adapter call: merge the given
   * per-call overrides over the store-wide `retry` / `timeout` / `deadline`,
   * falling back to the built-in {@link defaultRetry}. Layered helpers such as
   * `@supergrain/queries` call this so a query fetch inherits the same resolved
   * resilience as a document `find` unless it overrides them. Replaces the
   * former `defaults` field — resolution lives in one place instead of leaking
   * the store's raw defaults onto its surface.
   */
  resolveAdapterOptions(perCall?: AdapterOptionOverrides): ResolvedAdapterOptions;
  /**
   * Run one adapter call on the store's engine — the boundary layered packages
   * (e.g. `@supergrain/queries`) use so their fetches are correct by
   * construction: per-call overrides resolve over the store's defaults, every
   * failed attempt (and deadline breach) reports to the store's `onError`
   * sink, and the call counts against the store's `maxConcurrency` cap. The
   * optional `onFailure` observes the same failures for the caller's own
   * handle bookkeeping; it runs even if the telemetry sink throws.
   */
  runAdapter<A>(
    invoke: (ctx: { signal: AbortSignal }) => Promise<A> | Effect.Effect<A, AdapterError>,
    options: StoreAdapterRunOptions,
  ): Effect.Effect<A, AdapterError>;
}

/**
 * Options for {@link DocumentStore.runAdapter}: the failing `type` / `keys`
 * for error construction and telemetry, per-call resilience overrides
 * ({@link AdapterOptionOverrides}), and an optional per-failure observer.
 */
export interface StoreAdapterRunOptions extends AdapterOptionOverrides {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  /**
   * Observe every failure of this call (each failed attempt and a `deadline`
   * breach), after the store's `onError` sink was notified. For the caller's
   * handle bookkeeping; a throw is swallowed by the engine.
   */
  readonly onFailure?: (error: AdapterError, info: AdapterFailureInfo) => void;
}

const IDLE_HANDLE: DocumentHandle<unknown> = Object.freeze({
  value: undefined,
  error: undefined,
  isFetching: false,
  fetchedAt: undefined,
  failureCount: 0,
  lastError: undefined,
  status: "pending" as const,
  promise: undefined,
});

const IDLE_HANDLES: DocumentsHandle<unknown> = Object.freeze({
  handles: Object.freeze([]) as Array<never>,
  values: Object.freeze([]) as Array<never>,
  status: "pending" as const,
  statusStrict: "pending" as const,
  promise: undefined,
  promiseStrict: undefined,
});

/**
 * Stable, total string key for a query params object. Object keys are sorted so
 * declaration order doesn't matter. `Date`s are encoded by their timestamp — a
 * bare `Date` has no own-enumerable keys and would otherwise serialize to `{}`,
 * collapsing every date-valued param onto one cache slot. `bigint` is encoded
 * explicitly (it isn't valid JSON and would throw). Non-finite numbers
 * (`NaN` / `±Infinity`) are encoded distinctly — `JSON.stringify` turns them
 * into `null`, which would collide with each other and with a literal `null`.
 * A cyclic params object throws a clear error rather than overflowing the
 * stack. Params are expected to be JSON-ish (primitives, plain objects, arrays,
 * `Date`s); other exotic objects (`Map`/`Set`/class instances) are only
 * distinguished by their own-enumerable keys, so prefer plain params.
 */
function stableStringify(value: unknown): string {
  return stableStringifyInner(value, new WeakSet<object>());
}

function stableStringifyInner(value: unknown, seen: WeakSet<object>): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Date) return `Date(${value.getTime()})`;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number" && !Number.isFinite(value)) {
    // NaN / Infinity / -Infinity all serialize to "null" via JSON.stringify;
    // encode them distinctly so they don't collapse onto one cache slot.
    if (Number.isNaN(value)) return "NaN";
    return value > 0 ? "Infinity" : "-Infinity";
  }
  if (typeof value !== "object") {
    // string / number / boolean serialize stably; symbol / function are not
    // valid JSON (JSON.stringify → undefined), so fall back to String() to
    // keep this function total rather than returning a non-string.
    return JSON.stringify(value) ?? String(value);
  }
  if (seen.has(value)) {
    throw new Error(
      "@supergrain/silo: query params must be acyclic — a cycle was found while building the cache key",
    );
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((v) => stableStringifyInner(v, seen)).join(",")}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringifyInner(obj[k], seen)}`)
      .join(",")}}`;
  } finally {
    // Drop after fully serializing this node so sibling references to the same
    // object (a DAG, not a cycle) aren't falsely flagged.
    seen.delete(value);
  }
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
 * True when the handle has never loaded (no value, no prior error) and no
 * fetch is in flight — i.e. `find`/`findQuery` must enqueue a request.
 * Errored handles don't auto-retry; loaded handles serve from cache.
 *
 * The gate is bookkeeping, not data the caller asked to observe — read it
 * UNTRACKED via the raw target (the same pattern `applyEvent` uses), so a
 * tracked render calling `find`/`findQuery` doesn't get subscribed to
 * `isFetching`/`error` it never reads. Otherwise a `value`-only reader would
 * re-render whenever a background refetch toggles `isFetching`, breaking the
 * per-field contract documented on `DocumentHandle`.
 */
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

  const store: DocumentStore<M, Q> = {
    find<K extends keyof M & string>(type: K, id: string | null | undefined): DocumentHandle<M[K]> {
      if (id === null || id === undefined) return IDLE_HANDLE as DocumentHandle<M[K]>;
      const handle = getOrCreateHandle(ensureBucket(state.documents, type), id);
      if (needsFetch(handle)) {
        // Validate only when a fetch must be enqueued — an unconfigured type
        // would otherwise enqueue a request no drain can serve, killing the
        // whole batch window and stranding every handle in it. A cached
        // document (e.g. a sideload inserted under a type with no model
        // config) stays readable: the cache path never needs an adapter.
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

    findAll<K extends keyof M & string>(
      type: K,
      ids: string[] | null | undefined,
    ): DocumentsHandle<M[K]> {
      if (ids === null || ids === undefined) {
        return IDLE_HANDLES as DocumentsHandle<M[K]>;
      }
      // `find` is stable + idempotent: same reactive handle per id, and it only
      // enqueues a fetch when one is needed — so mapping over ids both triggers
      // the loads and collects the handles in id order.
      // Batch to combine find's internal batch calls.
      // oxlint-disable-next-line no-array-method-this-argument -- DocumentStore#find, not Array#find
      const handles = batch(() => ids.map((id) => store.find(type, id)));
      return new DocumentsHandleImpl<M[K]>(handles);
    },

    findInMemory<K extends keyof M & string>(type: K, id: string): M[K] | undefined {
      return state.documents.get(type)?.get(id)?.value as M[K] | undefined;
    },

    insertDocument<K extends keyof M & string>(type: K, doc: M[K]): void {
      // Stored docs are LIVE and reactive at field granularity — not frozen
      // snapshots. The kernel wraps the inserted object in a reactive proxy
      // (read.ts), so a `handle.value.<field>` read subscribes to just that
      // field, and there are two ways to update a document:
      //   1. Mutate a field in place (`handle.value.attributes.name = "Ada"`).
      //      Fine-grained: only readers of that field re-render. The write goes
      //      through the proxy's signal, so no reinsert is needed.
      //   2. Insert a NEW object. Wholesale replace; readers of the whole doc
      //      re-render. `applyEvent` writes `handle.value` only when the
      //      reference actually changes (`raw.value !== value` in
      //      transitions.ts), so swapping in a fresh object always notifies.
      // No copy is made — the inserted (or `prepareInsert`-returned) object IS
      // the stored target (unwrap the handle's value to recover the exact
      // reference). We deliberately do NOT freeze: a frozen target is handed
      // back unwrapped by the kernel (`createReactiveProxy` bails on
      // `Object.isFrozen`), which would kill per-field reactivity and the
      // in-place update path above.
      //
      // `hooks.prepareInsert` is the one funnel every document passes through on
      // its way in (direct inserts, processor/sideload inserts, Provider seeds).
      // Pass-through follows the response-processor `?? response` convention:
      // returning nothing keeps the (possibly mutated) `doc`; only an explicit
      // `null` vetoes the insert. Run it before wrapping so in-place edits to a
      // brand-new object touch the plain object, not the reactive proxy.
      const prepareInsert = config.hooks?.prepareInsert;
      let prepared: M[K] = doc;
      if (prepareInsert) {
        const result = prepareInsert(type, doc);
        if (result === null) return; // explicit veto — write nothing
        prepared = result ?? doc; // undefined / no return = keep `doc` as-is
      }
      batch(() => {
        const handle = getOrCreateHandle(ensureBucket(state.documents, type), prepared.id);
        applyEvent(handle, HandleEvent.insert(prepared));
      });
      // `afterInsert` tails the pipeline. The value is committed (findInMemory
      // returns it); within an enclosing batch — a fetch commit, or a caller's
      // own batch() — subscriber notifications are still pending and flush when
      // that outermost batch ends. Skipped when `prepareInsert` vetoed. Isolated
      // like the `onError` sink: a throwing observer is reported, never allowed
      // to corrupt the commit or fail sibling docs in the same fetch.
      const afterInsert = config.hooks?.afterInsert;
      if (afterInsert) {
        try {
          afterInsert(type, prepared);
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
      // The null short-circuit comes first — it never fetches, so the
      // conditional-read idiom `findQuery(type, ready ? params : null)` keeps
      // working even while the type is absent from config (e.g. feature-flagged
      // out).
      if (params === null || params === undefined)
        return IDLE_HANDLE as QueryHandle<Q[K]["result"]>;

      const paramsKey = stableStringify(params);
      const handle = getOrCreateHandle(ensureBucket(state.queries, type), paramsKey);
      if (needsFetch(handle)) {
        // Validate only when a fetch must be enqueued — an unconfigured type
        // would otherwise enqueue a request no drain can serve, stranding the
        // handle. A result seeded via `insertQueryResult` stays readable.
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
      // Like insertDocument: query results are live and reactive — not frozen.
      // An object result is wrapped in a reactive proxy by the kernel, so reads
      // track the fields they touch and an in-place mutation re-renders just
      // those subscribers. Update in place or insert a fresh result; both work.
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
        // Layered fetches share the finder's semaphore, so `maxConcurrency`
        // is one store-wide cap — not a per-surface one.
        permits: finder.permits,
        onFailure: (error, info) => {
          // Telemetry first, isolated — a throwing sink must not skip the
          // caller's own bookkeeping.
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

  // Expose a non-enumerable introspection bridge for devtools. Purely
  // observational — it hands out the live reactive `state` (so a client
  // subscribes via the kernel) plus the configured type names; it never calls
  // `find`, so inspecting a store can't trigger fetches. See `./devtools`.
  attachSiloDevtools(store, {
    state,
    documentTypes: Object.keys(config.models),
    queryTypes: Object.keys(config.queries ?? {}),
    clearMemory: () => store.clearMemory(),
  });

  return store;
}

// Re-export query handle types so `store.findQuery(...)` call sites don't need
// a second import path.
export type { QueryHandle };
