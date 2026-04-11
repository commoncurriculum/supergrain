import type {
  AcquireOptions,
  ConnectionStatus,
  DocumentPromise,
  DocumentsPromise,
  DocumentTypes,
  QueryDef,
  QueryPromise,
  Store,
} from "@supergrain/store";
import type { ReactNode } from "react";

/**
 * React-facing store binding returned by `createStoreContext`.
 *
 * Includes a `Provider`, a `useStore` hook, and typed hooks for documents
 * and queries. All hooks are bound to the specific `Models` map.
 */
export interface StoreContext<M extends DocumentTypes> {
  /** React context provider that makes the store available to descendants. */
  Provider: (props: { children: ReactNode }) => ReactNode;

  /** Access the underlying `Store<M>` from context. */
  useStore: () => Store<M>;

  /**
   * Read a document (or array of documents) by (type, id).
   *
   * Internally calls `store.findDoc` on every render (pure, cached) and
   * `store.acquireDoc` in a `useEffect` keyed to `(type, id)`. The effect
   * cleanup releases the acquire, driving refcount-based subscription
   * lifecycle.
   *
   * - Single `id` → `DocumentPromise<T>`
   * - Array of ids → `DocumentsPromise<T>`
   * - `null`/`undefined` id → idle `DocumentPromise<T>`
   */
  useDocument: UseDocument<M>;

  /**
   * Run a server-named query. Internally calls `store.query` on render
   * and `store.acquireQuery` in a `useEffect` keyed to the query's
   * *hashed* key — NOT to the `def` object's reference identity.
   *
   * This means callers may pass a fresh `{ type, id, params }` literal
   * every render without churning acquisitions: the hook hashes the def
   * using the same rules as `QueryDef` (sorted-key params, ordered
   * arrays) and only re-acquires when the hash actually changes.
   *
   * Passing `null`/`undefined` returns a synthetic IDLE handle (all
   * fields empty, no adapter call) and does not acquire.
   */
  useQuery: (def: QueryDef | null | undefined, opts?: AcquireOptions) => QueryPromise;

  /**
   * Reactive transport connection status. Re-renders the calling
   * component when `store.setConnection(...)` changes the value.
   */
  useConnection: () => ConnectionStatus;
}

export interface UseDocument<M extends DocumentTypes> {
  <K extends keyof M & string>(
    type: K,
    id: string | null | undefined,
    opts?: AcquireOptions,
  ): DocumentPromise<M[K]>;

  <K extends keyof M & string>(
    type: K,
    ids: readonly string[] | null | undefined,
    opts?: AcquireOptions,
  ): DocumentsPromise<M[K]>;
}
