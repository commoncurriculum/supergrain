import type { QueryHandle, QueryTypes, RegisteredQueries } from "../queries";

import { createContext, createElement, useContext, useState, type ReactNode } from "react";

import {
  createDocumentStore,
  type DocumentHandle,
  type DocumentStore,
  type DocumentStoreConfig,
  type DocumentTypes,
  type RegisteredTypes,
} from "../store";
import { DocumentStoreContext } from "./context";

/**
 * Extract the document-types map `M` from a `DocumentStore<M, Q>` type.
 */
export type ModelsOf<S> = S extends DocumentStore<infer M, QueryTypes> ? M : never;

/**
 * Extract the query-types map `Q` from a `DocumentStore<M, Q>` type.
 */
export type QueriesOf<S> = S extends DocumentStore<DocumentTypes, infer Q> ? Q : never;

/**
 * Optional declarative seed data for a Provider. `model` keys docs by id;
 * `query` keys results by their params object (a list since params aren't
 * natural dict keys).
 */
export interface InitialDocumentStoreData<M extends DocumentTypes, Q extends QueryTypes> {
  model?: { [K in keyof M]?: Record<string, M[K]> };
  query?: {
    [K in keyof Q]?: ReadonlyArray<{ params: Q[K]["params"]; result: Q[K]["result"] }>;
  };
}

function seedModels<M extends DocumentTypes, Q extends QueryTypes>(
  store: DocumentStore<M, Q>,
  models: NonNullable<InitialDocumentStoreData<M, Q>["model"]>,
): void {
  for (const type of Object.keys(models) as Array<keyof M & string>) {
    const bucket = models[type];
    if (bucket) {
      for (const id of Object.keys(bucket)) {
        const doc = bucket[id];
        if (doc) store.insertDocument(type, doc);
      }
    }
  }
}

function seedQueries<M extends DocumentTypes, Q extends QueryTypes>(
  store: DocumentStore<M, Q>,
  queries: NonNullable<InitialDocumentStoreData<M, Q>["query"]>,
): void {
  for (const type of Object.keys(queries) as Array<keyof Q & string>) {
    const list = queries[type];
    if (list) {
      for (const entry of list) {
        store.insertQueryResult(type, entry.params, entry.result);
      }
    }
  }
}

/**
 * Create an isolated document-store React binding — Context + Provider + hooks,
 * all tied to a fresh React Context that doesn't collide with any other call
 * to this factory.
 *
 * Mirrors `createStoreContext<T>()` from `@supergrain/kernel/react`: the type
 * parameter `S` is the full store type; the Provider takes the same `config`
 * you'd pass to `createDocumentStore` and constructs the store internally
 * exactly once per mount. Every SSR request, every test, every React tree
 * gets an isolated store by construction.
 *
 * Optional `initial` seeds documents and query results before the first
 * render. Optional `onMount` runs synchronously after seeding for imperative
 * setup (preloads, subscriptions). Both run inside the `useState`
 * initializer, so under React StrictMode in dev they are double-invoked —
 * keep them idempotent.
 *
 * @example
 * ```tsx
 * type DocStore = DocumentStore<TypeToModel, TypeToQuery>;
 * export const { Provider, useDocumentStore, useDocument, useQuery } =
 *   createDocumentStoreContext<DocStore>();
 *
 * <Provider config={{ models, queries }} onMount={(store) => store.find("user", "1")}>
 *   <App />
 * </Provider>
 * ```
 */
export function createDocumentStoreContext<
  S extends DocumentStore<DocumentTypes, QueryTypes> = DocumentStore<
    RegisteredTypes,
    RegisteredQueries
  >,
>(): {
  Provider: (props: {
    config: DocumentStoreConfig<ModelsOf<S>, QueriesOf<S>>;
    initial?: InitialDocumentStoreData<ModelsOf<S>, QueriesOf<S>>;
    onMount?: (store: S) => void;
    children: ReactNode;
  }) => ReactNode;
  useDocumentStore: () => S;
  useDocument: <K extends keyof ModelsOf<S> & string>(
    type: K,
    id: string | null | undefined,
  ) => DocumentHandle<ModelsOf<S>[K]>;
  useQuery: <K extends keyof QueriesOf<S> & string>(
    type: K,
    params: QueriesOf<S>[K]["params"] | null | undefined,
  ) => QueryHandle<QueriesOf<S>[K]["result"]>;
} {
  type M = ModelsOf<S>;
  type Q = QueriesOf<S>;

  const Context = createContext<S | null>(null);

  function Provider({
    config,
    initial,
    onMount,
    children,
  }: {
    config: DocumentStoreConfig<M, Q>;
    initial?: InitialDocumentStoreData<M, Q>;
    onMount?: (store: S) => void;
    children: ReactNode;
  }): ReactNode {
    const [store] = useState<S>(() => {
      const s = createDocumentStore<M, Q>(config);
      if (initial?.model) seedModels(s, initial.model);
      if (initial?.query) seedQueries(s, initial.query);
      onMount?.(s as unknown as S);
      return s as unknown as S;
    });
    return createElement(
      Context.Provider,
      { value: store },
      createElement(
        DocumentStoreContext.Provider,
        // S extends DocumentStore<DocumentTypes, QueryTypes>, so this upcast is safe.
        { value: store as DocumentStore<DocumentTypes, QueryTypes> },
        children,
      ),
    );
  }

  function useDocumentStore(): S {
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
    // useDocumentStore() returns S which extends DocumentStore<M, Q>; the cast
    // narrows back to the concrete DocumentStore<M, Q> so .find() is callable.
    const store = useDocumentStore() as unknown as DocumentStore<M, Q>;
    // oxlint-disable-next-line no-array-method-this-argument -- DocumentStore#find, not Array#find
    return store.find(type, id);
  }

  function useQuery<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"] | null | undefined,
  ): QueryHandle<Q[K]["result"]> {
    // Same narrowing cast as useDocument above.
    const store = useDocumentStore() as unknown as DocumentStore<M, Q>;
    return store.findQuery(type, params);
  }

  return { Provider, useDocumentStore, useDocument, useQuery };
}
