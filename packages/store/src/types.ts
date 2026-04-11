// =============================================================================
// Model types
// =============================================================================

/**
 * Consumer-defined map of model type name → attributes shape.
 * Each key is a model type (e.g. "user", "card-stack"), each value is the
 * shape of that model's `attributes` payload.
 */
export type DocumentTypes = Record<string, unknown>;

/** Wire-format document as returned by adapters and stored in the cache. */
export interface Doc<T = unknown> {
  type: string;
  id: string;
  attributes: T;
  meta?: DocMeta;
}

/**
 * Wire-format document metadata. Carried through the cache but not exposed
 * directly on handles — handles expose normalized `fetchedAt: Date` and
 * `revision: number | undefined` instead.
 */
export interface DocMeta {
  /** Monotonic server revision, if tracked. */
  revision?: number;
  /** ISO timestamp of the fetch that produced this doc (wire format). */
  requestedAt?: string;
  [key: string]: unknown;
}

/** A reference to a document by type + id. */
export interface Ref {
  type: string;
  id: string;
}

// =============================================================================
// Adapter responses
// =============================================================================

export interface DocumentResponse<T = unknown> {
  data: Doc<T>[];
  included?: Doc<unknown>[];
}

/**
 * Response from a `QueryAdapter.fetch`.
 *
 * Pagination note: `nextOffset === null` AND `nextOffset === undefined` BOTH
 * mean "no more pages." An adapter that omits `nextOffset` is treated as
 * exhausted. To indicate "more exists," return a number.
 */
export interface QueryResponse {
  /** Refs for the requested page, in the order they should be rendered. */
  data: Ref[];
  /** Full documents to normalize into the doc cache. */
  included?: Doc<unknown>[];
  /**
   * Cursor for the next page. `null` or `undefined` means exhausted.
   * A number is an opaque cursor that will be passed back to the adapter
   * in `ResolvedQueryDef.page.offset` on the next `fetchNextPage()` call.
   */
  nextOffset?: number | null;
}

// =============================================================================
// Adapters (per-type)
// =============================================================================

export interface DocumentAdapter<T = unknown> {
  find(ids: string[]): Promise<DocumentResponse<T>>;
}

export interface QueryAdapter {
  fetch(def: ResolvedQueryDef): Promise<QueryResponse>;
}

// =============================================================================
// Queries
// =============================================================================

/**
 * A server-named query. The cache key is a stable hash derived from
 * `{type, id, params, pageSize}`. Key stability rules:
 *
 * - Key ordering in `params` does NOT matter: `{a:1, b:2}` and `{b:2, a:1}`
 *   produce the same hash (deep, sorted-key serialization).
 * - Nested objects follow the same rule at every level.
 * - Arrays are ordered: `[1,2]` and `[2,1]` are DIFFERENT.
 * - Missing fields are distinct from `null`/`undefined` only insofar as
 *   they don't appear in the hash input at all.
 */
export interface QueryDef<TParams extends Record<string, unknown> = Record<string, unknown>> {
  /** Server-defined query name (matches a key in `queries` config). */
  type: string;
  /** Entity the query is scoped to (e.g. a userId). Optional. */
  id?: string;
  /** Additional parameters; hashed into the query cache key client-side. */
  params?: TParams;
  pageSize?: number;
}

/**
 * QueryDef plus the concrete page cursor the adapter is being asked for.
 *
 * Pagination model for v1 is offset/limit. `offset` comes from the previous
 * response's `nextOffset` (or 0 for the first page). `limit` is `pageSize`
 * from the QueryDef (or an implementation default).
 */
export interface ResolvedQueryDef<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  type: string;
  id?: string;
  params?: TParams;
  page: { offset: number; limit: number };
}

// =============================================================================
// Persistence (fall-through cache tier)
// =============================================================================

/**
 * Optional fall-through storage tier. Reads walk memory → storage → network.
 * Writes to memory also write-through to storage (fire-and-forget).
 */
export interface PersistenceAdapter {
  getDocument(type: string, id: string): Promise<Doc<unknown> | undefined>;
  writeDocument(doc: Doc<unknown>): void;
  getQuery(key: string): Promise<PersistedQueryState | undefined>;
  writeQuery(key: string, state: PersistedQueryState): void;
  evict(type: string, id: string): void;
  clear(): Promise<void>;
}

export interface PersistedQueryState {
  refs: Ref[][];
  /** Same shape as `QueryResponse.nextOffset`. `null` means exhausted. */
  nextOffset: number | null;
  /** ISO timestamp. */
  fetchedAt: string;
}

// =============================================================================
// Subscriptions (server-pushed invalidation)
// =============================================================================

export type OnInvalidate = () => void;
export type Unsubscribe = () => void;

export type SubscribeDocFn = (type: string, id: string, onInvalidate: OnInvalidate) => Unsubscribe;

export type SubscribeQueryFn = (def: QueryDef, onInvalidate: OnInvalidate) => Unsubscribe;

// =============================================================================
// Connection state
// =============================================================================

export type ConnectionStatus = "online" | "offline" | "degraded";

// =============================================================================
// Handle status
// =============================================================================

/**
 * - `idle`    – no fetch attempted (id was null/undefined)
 * - `pending` – first fetch in flight, no data yet
 * - `success` – data present (may also be refetching; check `isFetching`)
 * - `error`   – fetch failed, no fallback data available
 */
export type Status = "idle" | "pending" | "success" | "error";

// =============================================================================
// Handles returned by Store methods (reactive)
// =============================================================================

/**
 * Reactive handle for a single document. Read `data` etc. inside a
 * supergrain `tracked()` scope to subscribe to changes.
 *
 * Idle invariant — when `status === "idle"`, all of:
 * - `data === undefined`
 * - `error === undefined`
 * - `isPending === false`
 * - `isFetching === false`
 * - `hasData === false`
 * - `fetchedAt === undefined`
 * - `revision === undefined`
 * - `promise === undefined`
 */
export interface DocumentPromise<T> {
  readonly status: Status;
  readonly data: T | undefined;
  readonly error: Error | undefined;

  /** True only before the first successful load. Never flips back to true on refetch. */
  readonly isPending: boolean;
  /** True whenever any fetch (initial OR refetch) is in flight. */
  readonly isFetching: boolean;
  readonly hasData: boolean;

  /** Client wall-clock Date of the last successful fetch. */
  readonly fetchedAt: Date | undefined;
  /** Server-provided monotonic revision, if the adapter/server supplies one. */
  readonly revision: number | undefined;

  /**
   * Stable Promise for use with React 19's `use()`.
   *
   * - Resolves exactly once on first successful load.
   * - Refetches do NOT create new promises — they update `data`/`isFetching`.
   * - If the first fetch errors, the promise rejects once.
   * - A successful refetch AFTER an error creates a NEW promise (so consumers
   *   inside Suspense boundaries can recover via error boundaries).
   */
  readonly promise: Promise<T> | undefined;

  /**
   * Trigger a refetch. No-op if a fetch is already in flight — returns the
   * existing in-flight work rather than spawning a duplicate.
   */
  refetch(): void;
}

/** Reactive handle for a bulk find-by-ids. */
export interface DocumentsPromise<T> {
  readonly status: Status;
  readonly items: T[] | undefined;
  readonly error: Error | undefined;

  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly hasData: boolean;

  readonly fetchedAt: Date | undefined;
  readonly promise: Promise<T[]> | undefined;

  refetch(): void;
}

/**
 * Reactive handle for a server-named query.
 *
 * Exposes `refs` — a polymorphic list of `{type, id}` — rather than projected
 * documents. Consumers iterate refs and call `findDoc(ref.type, ref.id)` per
 * row (typically inside a `tracked()` row component), which keeps queries
 * type-agnostic and plays well with supergrain's fine-grained reactivity.
 *
 * Ref order is preserved from the server response.
 */
export interface QueryPromise {
  readonly status: Status;
  readonly refs: readonly Ref[] | undefined;
  readonly error: Error | undefined;

  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly hasData: boolean;

  /** Server-provided cursor for the next page. `null` when exhausted. */
  readonly nextOffset: number | null;

  readonly fetchedAt: Date | undefined;
  readonly promise: Promise<readonly Ref[]> | undefined;

  /** No-op if already on the last page (`nextOffset === null`). */
  fetchNextPage(): void;
  /** No-op if a fetch is already in flight. */
  refetch(): void;
}

// =============================================================================
// Store config
// =============================================================================

/**
 * Options for `acquireDoc` / `acquireQuery`.
 *
 * `findDoc` and `query` take no options — they are side-effect-free reads
 * (apart from the coalesced fetch). The refcount + live-subscription
 * lifecycle is controlled entirely through acquire.
 */
export interface AcquireOptions {
  /**
   * Grace period after the last release before the underlying
   * subscription is actually torn down, in ms. Absorbs React route
   * transitions that unmount + remount within a short window.
   *
   * `0` means "tear down on the next microtask after release" (not
   * synchronously) — this keeps behavior predictable and gives React
   * strict mode double-mounts a chance to cancel the teardown.
   *
   * Defaults to `StoreConfig.keepAliveMs`.
   */
  keepAliveMs?: number;
}

export interface StoreConfig<M extends DocumentTypes> {
  /** Per-type document fetchers. One entry required per model type in M. */
  adapters: { [K in keyof M]: DocumentAdapter<M[K]> };

  /** Per-type query fetchers. Optional until you start using `store.query`. */
  queries?: Record<string, QueryAdapter>;

  /** Live invalidation for documents. */
  subscribeDoc?: SubscribeDocFn;
  /** Live invalidation for queries. */
  subscribeQuery?: SubscribeQueryFn;

  /** Fall-through storage tier (IDB, localStorage, etc.). */
  persistence?: PersistenceAdapter;

  /** Coalescer batch window in ms. Default: 15. */
  batchWindowMs?: number;
  /** Max ids per adapter.find call. Default: 60. */
  batchSize?: number;
  /** Default refcount grace period in ms. Default: 30_000. */
  keepAliveMs?: number;
}

// =============================================================================
// Store events (devtools / observability)
// =============================================================================

export type StoreEvent =
  | { kind: "doc-insert"; type: string; id: string }
  | { kind: "doc-fetch-start"; type: string; ids: string[] }
  | { kind: "doc-fetch-success"; type: string; ids: string[] }
  | { kind: "doc-fetch-error"; type: string; ids: string[]; error: Error }
  | { kind: "query-fetch-start"; key: string }
  | { kind: "query-fetch-success"; key: string }
  | { kind: "query-fetch-error"; key: string; error: Error }
  | { kind: "invalidate-doc"; type: string; id: string }
  | { kind: "invalidate-query"; key: string }
  | { kind: "connection-change"; status: ConnectionStatus };

// =============================================================================
// Store (public interface)
// =============================================================================

export interface Store<M extends DocumentTypes> {
  /**
   * Read one or many documents by (type, id). Returns a reactive handle
   * immediately; the underlying fetch is coalesced with other calls in
   * the same batch window.
   *
   * `findDoc` is side-effect-free for liveness — it triggers an initial
   * fetch if needed but does NOT subscribe to server-pushed updates.
   * For live updates, pair with `acquireDoc`.
   *
   * - Single `id` → `DocumentPromise<T>`
   * - Array of ids → `DocumentsPromise<T>`
   * - `null`/`undefined` → idle handle, no fetch attempted
   *
   * Runtime errors:
   * - Throws if `type` has no registered adapter in `StoreConfig.adapters`.
   *   (TypeScript generally catches this at compile time; the runtime
   *   check guards against untyped callers.)
   */
  findDoc<K extends keyof M & string>(
    type: K,
    id: string | null | undefined,
  ): DocumentPromise<M[K]>;
  findDoc<K extends keyof M & string>(
    type: K,
    ids: readonly string[] | null | undefined,
  ): DocumentsPromise<M[K]>;

  /**
   * Run a server-named query. Returns a reactive handle immediately.
   *
   * Response `included` docs are normalized into the doc cache; response
   * `data` becomes `refs` projected through it. Like `findDoc`, `query`
   * is side-effect-free for liveness — pair with `acquireQuery` for
   * server-pushed invalidation.
   *
   * Runtime errors:
   * - Throws if `def.type` has no registered query adapter in
   *   `StoreConfig.queries`.
   */
  query(def: QueryDef): QueryPromise;

  /**
   * Acquire a live subscription for a document (or array of documents).
   *
   * Increments the refcount; the first acquirer triggers `subscribeDoc`
   * (if configured). Returns a release function that, when called,
   * decrements the refcount and — after the keepAliveMs grace period —
   * tears down the subscription if the refcount has stayed at zero.
   *
   * Overlap semantics: acquiring an array of ids where one is already
   * acquired increments each id's refcount independently. The returned
   * release function decrements each by one.
   *
   * Passing `null`/`undefined` returns a no-op release function.
   *
   * @example
   * ```tsx
   * // Inside a React hook
   * useEffect(() => store.acquireDoc("user", userId), [userId])
   * ```
   */
  acquireDoc<K extends keyof M & string>(
    type: K,
    id: string | null | undefined,
    opts?: AcquireOptions,
  ): Unsubscribe;
  acquireDoc<K extends keyof M & string>(
    type: K,
    ids: readonly string[] | null | undefined,
    opts?: AcquireOptions,
  ): Unsubscribe;

  /**
   * Acquire a live subscription for a query. Same semantics as
   * `acquireDoc`: first acquirer calls `subscribeQuery`, release
   * decrements and tears down after the grace period.
   *
   * Passing `null`/`undefined` returns a no-op release function.
   */
  acquireQuery(def: QueryDef | null | undefined, opts?: AcquireOptions): Unsubscribe;

  /**
   * Direct write into the doc cache. Accepts a single document or an array.
   * Used by the transport layer when a query response's `included` arrives,
   * and by the (separate) writes/CRDT layer. Fully reactive — any handles
   * reading these docs will update.
   *
   * Write policy: if a fetch is currently in flight for one of the inserted
   * docs, the in-flight response is dropped when it returns — the direct
   * insert is authoritative. (Exception: if the in-flight response has a
   * strictly newer `meta.revision`, it wins. If neither has a revision,
   * last-write-wins.)
   */
  insertDocument(docOrDocs: Doc<unknown> | readonly Doc<unknown>[]): void;

  /** Reactive connection status. Read inside `tracked()` to react. */
  readonly connection: ConnectionStatus;

  /**
   * Call after socket reconnection. Refetches all currently-acquired
   * documents and queries (refcount > 0). Does NOT revalidate cold
   * cached docs that no one currently holds.
   */
  onReconnect(): void;

  /**
   * Observability / devtools hook. Receives every cache event.
   */
  subscribe(listener: (event: StoreEvent) => void): Unsubscribe;
}
