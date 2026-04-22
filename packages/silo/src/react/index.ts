import type { QueryHandle, QueryTypes, RegisteredQueries } from "../queries";
import type { DocumentHandle, DocumentStore, DocumentTypes, RegisteredTypes } from "../store";

import { createContext, createElement, useContext, useState, type ReactNode } from "react";

import { DocumentStoreContext } from "./context";

/**
 * Create an isolated document-store React binding — Context + Provider + hooks,
 * all tied to a fresh React Context that doesn't collide with any other call
 * to this factory.
 */
export function createDocumentStoreContext<
  M extends DocumentTypes = RegisteredTypes,
  Q extends QueryTypes = RegisteredQueries,
>(): {
  Provider: (props: { init: () => DocumentStore<M, Q>; children: ReactNode }) => ReactNode;
  useDocumentStore: () => DocumentStore<M, Q>;
  useDocument: <K extends keyof M & string>(
    type: K,
    id: string | null | undefined,
  ) => DocumentHandle<M[K]>;
  useQuery: <K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"] | null | undefined,
  ) => QueryHandle<Q[K]["result"]>;
} {
  const Context = createContext<DocumentStore<M, Q> | null>(null);

  function Provider({
    init,
    children,
  }: {
    init: () => DocumentStore<M, Q>;
    children: ReactNode;
  }): ReactNode {
    const [store] = useState(init);
    return createElement(
      Context.Provider,
      { value: store },
      createElement(
        DocumentStoreContext.Provider,
        { value: store as unknown as DocumentStore<DocumentTypes, QueryTypes> },
        children,
      ),
    );
  }

  function useDocumentStore(): DocumentStore<M, Q> {
    const store = useContext(Context);
    if (store === null) {
      throw new Error(
        "@supergrain/silo/react: useDocumentStore must be used within the Provider returned by createDocumentStoreContext()",
      );
    }
    return store;
  }

  function useDocument<K extends keyof M & string>(
    type: K,
    id: string | null | undefined,
  ): DocumentHandle<M[K]> {
    const store = useDocumentStore();
    // oxlint-disable-next-line no-array-method-this-argument -- DocumentStore#find, not Array#find
    return store.find(type, id);
  }

  function useQuery<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"] | null | undefined,
  ): QueryHandle<Q[K]["result"]> {
    const store = useDocumentStore();
    return store.findQuery(type, params);
  }

  return { Provider, useDocumentStore, useDocument, useQuery };
}
