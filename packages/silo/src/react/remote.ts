import type {
  RemoteQuery,
  RemoteQueryHandle,
  RemoteQueryOptions,
  RemoteQueryStore,
} from "../remote";

import { createContext, createElement, useContext, useEffect, type ReactNode } from "react";

import { stableStringify } from "../util";

/**
 * Create a React binding for a remote query store: a Provider and the hooks,
 * on their own Context. Mirrors `createDocumentStoreContext`.
 *
 * @example
 * ```tsx
 * export const { Provider, useRemoteQuery } = createRemoteQueryStoreContext<Request>();
 *
 * <Provider store={remoteQueryStore}><App /></Provider>
 *
 * const summary = useRemoteQuery(userActivitySummary, body, { refetchInterval: 30_000 });
 * ```
 */
export function createRemoteQueryStoreContext<Request = unknown>(): {
  Provider: (props: { store: RemoteQueryStore<Request>; children: ReactNode }) => ReactNode;
  useRemoteQueryStore: () => RemoteQueryStore<Request>;
  useRemoteQuery: <Params, Result>(
    query: RemoteQuery<Params, Result, Request>,
    params: Params | null | undefined,
    options?: RemoteQueryOptions,
  ) => RemoteQueryHandle<Result>;
} {
  const Context = createContext<RemoteQueryStore<Request> | null>(null);

  function Provider({
    store,
    children,
  }: {
    store: RemoteQueryStore<Request>;
    children: ReactNode;
  }): ReactNode {
    return createElement(Context.Provider, { value: store }, children);
  }

  function useRemoteQueryStore(): RemoteQueryStore<Request> {
    const store = useContext(Context);
    if (store === null) {
      throw new Error(
        "@supergrain/silo/react: useRemoteQueryStore must be used within the Provider returned by createRemoteQueryStoreContext()",
      );
    }
    return store;
  }

  function useRemoteQuery<Params, Result>(
    query: RemoteQuery<Params, Result, Request>,
    params: Params | null | undefined,
    options?: RemoteQueryOptions,
  ): RemoteQueryHandle<Result> {
    const store = useRemoteQueryStore();
    // oxlint-disable-next-line no-array-method-this-argument -- RemoteQueryStore#find, not Array#find
    const handle = store.find(query, params);
    // Keyed by value, so a body or options object rebuilt each render doesn't
    // re-observe.
    const paramsKey = params === null || params === undefined ? undefined : stableStringify(params);
    const optionsKey = stableStringify(options ?? {});
    useEffect(() => {
      if (params === null || params === undefined) return;
      return store.observe(query, params, options);
    }, [store, query, paramsKey, optionsKey]);
    return handle;
  }

  return { Provider, useRemoteQueryStore, useRemoteQuery };
}
