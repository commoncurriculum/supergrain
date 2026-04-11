import type { StoreContext, UseDocument } from "./types";
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

import { type ReactNode, createContext, createElement, useContext } from "react";

const notImplemented = (name: string): never => {
  throw new Error(`@supergrain/store-react: ${name} is not yet implemented`);
};

/**
 * Bind a `Store<M>` to React: returns a context provider plus typed
 * hooks (`useStore`, `useDocument`, `useQuery`, `useConnection`).
 *
 * Hooks handle refcount lifecycle: each `useDocument`/`useQuery` call
 * acquires on mount and releases on unmount. The store's keepAliveMs
 * grace period absorbs fast unmount+remount cycles (route transitions).
 *
 * @example
 * ```tsx
 * const store = createStore<Models>({ adapters: { ... } })
 * const { Provider, useDocument, useQuery } = createStoreContext(store)
 *
 * <Provider>
 *   <App />
 * </Provider>
 * ```
 */
export function createStoreContext<M extends DocumentTypes>(store: Store<M>): StoreContext<M> {
  const Context = createContext<Store<M> | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    return createElement(Context.Provider, { value: store }, children);
  }

  function useStore(): Store<M> {
    const value = useContext(Context);
    if (value === null) {
      throw new Error("useStore must be used within its Provider");
    }
    return value;
  }

  const useDocument = (<K extends keyof M & string>(
    _type: K,
    _idOrIds: string | readonly string[] | null | undefined,
    _opts?: AcquireOptions,
  ): DocumentPromise<M[K]> | DocumentsPromise<M[K]> => {
    return notImplemented("useDocument");
  }) as UseDocument<M>;

  const useQuery = (_def: QueryDef | null | undefined, _opts?: AcquireOptions): QueryPromise => {
    return notImplemented("useQuery");
  };

  const useConnection = (): ConnectionStatus => {
    return notImplemented("useConnection");
  };

  return {
    Provider,
    useStore,
    useDocument,
    useQuery,
    useConnection,
  };
}
