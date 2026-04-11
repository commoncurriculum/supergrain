import type {
  AcquireOptions,
  ConnectionStatus,
  DocumentPromise,
  DocumentsPromise,
  DocumentTypes,
  Store,
  StoreConfig,
  Unsubscribe,
} from "./types";

/**
 * Create a reactive, document-oriented store.
 *
 * This is the sole entry point. Configure per-type adapters, optional
 * query adapters, optional live subscriptions, and optional fall-through
 * persistence; the returned store handles caching, batching, and
 * reactive reads.
 *
 * @example
 * ```ts
 * const store = createStore<Models>({
 *   adapters: {
 *     user: { find: (ids) => ajax.request(`/users/${ids.join(",")}`) },
 *   },
 * })
 * ```
 */
export function createStore<M extends DocumentTypes>(_config: StoreConfig<M>): Store<M> {
  const notImplemented = (name: string): never => {
    throw new Error(`@supergrain/store: ${name} is not yet implemented`);
  };

  function findDoc<K extends keyof M & string>(
    type: K,
    id: string | null | undefined,
  ): DocumentPromise<M[K]>;
  function findDoc<K extends keyof M & string>(
    type: K,
    ids: readonly string[] | null | undefined,
  ): DocumentsPromise<M[K]>;
  function findDoc(_type: string, _idOrIds: string | readonly string[] | null | undefined): never {
    return notImplemented("findDoc");
  }

  function acquireDoc<K extends keyof M & string>(
    type: K,
    id: string | null | undefined,
    opts?: AcquireOptions,
  ): Unsubscribe;
  function acquireDoc<K extends keyof M & string>(
    type: K,
    ids: readonly string[] | null | undefined,
    opts?: AcquireOptions,
  ): Unsubscribe;
  function acquireDoc(
    _type: string,
    _idOrIds: string | readonly string[] | null | undefined,
    _opts?: AcquireOptions,
  ): Unsubscribe {
    return notImplemented("acquireDoc");
  }

  return {
    findDoc,
    acquireDoc,
    query(_def) {
      return notImplemented("query");
    },
    acquireQuery(_def, _opts) {
      return notImplemented("acquireQuery");
    },
    insertDocument(_docOrDocs) {
      notImplemented("insertDocument");
    },
    get connection(): ConnectionStatus {
      return "ONLINE";
    },
    setConnection(_status) {
      notImplemented("setConnection");
    },
    onReconnect() {
      notImplemented("onReconnect");
    },
    subscribe(_listener) {
      return notImplemented("subscribe");
    },
  };
}
