import type { QueryHandle, QueryTypes, RegisteredQueries } from "../queries";

import { createContext, createElement, useContext, useRef, useState, type ReactNode } from "react";

import {
  createDocumentStore,
  type DocumentHandle,
  type DocumentStore,
  type DocumentStoreConfig,
  type DocumentTypes,
  type RegisteredTypes,
} from "../store";
import {
  combineDocumentsTogether,
  type DocumentsTogetherHandle,
  IDLE_DOCUMENTS_TOGETHER_HANDLE,
} from "../together";
import { arrayEqual } from "../util";
import { DocumentStoreContext } from "./context";

export { createRemoteQueryStoreContext } from "./remote";

/** The document-types map `M` of a `DocumentStore<M, Q>`. */
export type ModelsOf<S> = S extends DocumentStore<infer M, QueryTypes> ? M : never;

/** The query-types map `Q` of a `DocumentStore<M, Q>`. */
export type QueriesOf<S> = S extends DocumentStore<DocumentTypes, infer Q> ? Q : never;

/** Seed data for a Provider: documents by type and id, query results by params. */
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

function resolveStore<M extends DocumentTypes, Q extends QueryTypes>(
  config: DocumentStoreConfig<M, Q> | undefined,
  store: DocumentStore<DocumentTypes, QueryTypes> | undefined,
): DocumentStore<M, Q> {
  if (config !== undefined && store !== undefined) {
    throw new Error(
      "@supergrain/silo/react: createDocumentStoreContext Provider takes exactly one of `config` (to construct a store) or `store` (to adopt an existing one), not both — an adopted store already has its config baked in",
    );
  }
  if (store !== undefined) return store as unknown as DocumentStore<M, Q>;
  if (config !== undefined) return createDocumentStore<M, Q>(config);
  throw new Error(
    "@supergrain/silo/react: createDocumentStoreContext Provider requires either a `config` (to construct a store) or a `store` (to adopt an existing one)",
  );
}

/**
 * Create a document-store React binding: a Provider and hooks on their own
 * Context. The Provider builds one store per mount from `config`, or binds a
 * prebuilt `store`; pass exactly one.
 *
 * `initial` seeds documents and query results before the first render, then
 * `onMount` runs. Both run inside a `useState` initializer, so StrictMode may
 * run them twice: keep them idempotent.
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
    config?: DocumentStoreConfig<ModelsOf<S>, QueriesOf<S>>;
    store?: S;
    initial?: InitialDocumentStoreData<ModelsOf<S>, QueriesOf<S>>;
    onMount?: (store: S) => void;
    children: ReactNode;
  }) => ReactNode;
  useDocumentStore: () => S;
  useDocument: <K extends keyof ModelsOf<S> & string>(
    type: K,
    id: string | null | undefined,
  ) => DocumentHandle<ModelsOf<S>[K]>;
  useDocumentsIndividually: <K extends keyof ModelsOf<S> & string>(
    type: K,
    ids: string[] | null | undefined,
  ) => Array<DocumentHandle<ModelsOf<S>[K]>>;
  useDocumentsTogether: <K extends keyof ModelsOf<S> & string>(
    type: K,
    ids: string[] | null | undefined,
  ) => DocumentsTogetherHandle<ModelsOf<S>[K]>;
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
    store: providedStore,
    initial,
    onMount,
    children,
  }: {
    config?: DocumentStoreConfig<M, Q>;
    store?: S;
    initial?: InitialDocumentStoreData<M, Q>;
    onMount?: (store: S) => void;
    children: ReactNode;
  }): ReactNode {
    const [store] = useState<S>(() => {
      const s = resolveStore<M, Q>(config, providedStore);
      if (initial?.model) seedModels(s, initial.model);
      if (initial?.query) seedQueries(s, initial.query);
      const typedStore = s as unknown as S;
      onMount?.(typedStore);
      return typedStore;
    });
    return createElement(
      Context.Provider,
      { value: store },
      createElement(
        DocumentStoreContext.Provider,
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
    const store = useDocumentStore() as unknown as DocumentStore<M, Q>;
    // oxlint-disable-next-line no-array-method-this-argument -- DocumentStore#find, not Array#find
    return store.find(type, id);
  }

  function useDocumentsIndividually<K extends keyof M & string>(
    type: K,
    ids: string[] | null | undefined,
  ): Array<DocumentHandle<M[K]>> {
    // `findDocumentsIndividually` returns a fresh array each call; keep the
    // identity stable while the handles are unchanged.
    const store = useDocumentStore() as unknown as DocumentStore<M, Q>;
    const next = store.findDocumentsIndividually(type, ids);
    const ref = useRef(next);
    if (!arrayEqual(ref.current, next)) ref.current = next;
    return ref.current;
  }

  function useDocumentsTogether<K extends keyof M & string>(
    type: K,
    ids: string[] | null | undefined,
  ): DocumentsTogetherHandle<M[K]> {
    // The wrapper's promise must keep its identity for React's `use()`. `idle`
    // is tracked because `null` ids and `[]` share the same empty handle array.
    const handles = useDocumentsIndividually(type, ids);
    const idle = ids === null || ids === undefined;
    const ref = useRef<{
      idle: boolean;
      handles: Array<DocumentHandle<M[K]>>;
      together: DocumentsTogetherHandle<M[K]>;
    } | null>(null);
    if (ref.current === null || ref.current.idle !== idle || ref.current.handles !== handles) {
      ref.current = {
        idle,
        handles,
        together: idle ? IDLE_DOCUMENTS_TOGETHER_HANDLE : combineDocumentsTogether(handles),
      };
    }
    return ref.current.together;
  }

  function useQuery<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"] | null | undefined,
  ): QueryHandle<Q[K]["result"]> {
    const store = useDocumentStore() as unknown as DocumentStore<M, Q>;
    return store.findQuery(type, params);
  }

  return {
    Provider,
    useDocumentStore,
    useDocument,
    useDocumentsIndividually,
    useDocumentsTogether,
    useQuery,
  };
}
