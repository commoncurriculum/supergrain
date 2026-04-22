import type { QueryHandle, QueryTypes, RegisteredQueries } from "../queries";
import type { DocumentHandle, DocumentStore, DocumentTypes, RegisteredTypes } from "../store";

import { createContext, createElement, useContext, useState, type ReactNode } from "react";

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
    return createElement(Context.Provider, { value: store }, children);
  }

  function useDocumentStore(): DocumentStore<M, Q> {
    const store = useContext(Context);
    if (store === null) {
      throw new Error(
        "@supergrain/document-store/react: useDocumentStore must be used within the Provider returned by createDocumentStoreContext()",
      );
    }
    return store;
  }

  function useDocument<K extends keyof M & string>(
    _type: K,
    _id: string | null | undefined,
  ): DocumentHandle<M[K]> {
    useDocumentStore();
    throw new Error("@supergrain/document-store/react: useDocument is not yet implemented");
  }

  function useQuery<K extends keyof Q & string>(
    _type: K,
    _params: Q[K]["params"] | null | undefined,
  ): QueryHandle<Q[K]["result"]> {
    useDocumentStore();
    throw new Error("@supergrain/document-store/react: useQuery is not yet implemented");
  }

  return { Provider, useDocumentStore, useDocument, useQuery };
}
