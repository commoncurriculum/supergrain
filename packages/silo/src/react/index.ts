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
 * Resolve the store a Provider binds to context. `config` and `store` are the
 * two ends of one pipeline — `config` is the recipe, `store` is the result of
 * `createDocumentStore(config)` — so exactly one is required: construct from
 * `config` (the common case — an isolated store per mount), or adopt a pre-built
 * `store`. With neither there's nothing to bind; with both the `config` would be
 * redundant (an adopted store already has its config baked in). Either violation
 * throws.
 *
 * `store` arrives as the caller's `S`, which by construction extends
 * `DocumentStore<DocumentTypes, QueryTypes>`; narrow it to the concrete
 * `DocumentStore<M, Q>` (the same upcast `useDocument`/`useQuery` use).
 */
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
 * Pass `store` instead of `config` to adopt a store instance you built outside
 * React — to share one store across multiple React roots, or to drive it from
 * non-React code — and the Provider binds that instance to context as-is rather
 * than constructing a new one. (For a Provider-owned store, `config` with
 * `initial`/`onMount` already covers seeding and imperative setup.) `config`
 * and `store` are the two ends of one pipeline (recipe vs. built store), so
 * provide exactly one — supplying neither, or both, throws.
 *
 * Optional `initial` seeds documents and query results before the first
 * render. Optional `onMount` runs synchronously after seeding for imperative
 * setup (preloads, subscriptions). Both run regardless of whether the store
 * was constructed from `config` or adopted via `store`, and both run inside
 * the `useState` initializer, so under React StrictMode in dev (and on an
 * adopted store that's shared across trees) they may run more than once —
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
      // Resolve which store to use (construct from config, or adopt the
      // provided one), then seed + mount it the same way regardless of source —
      // so `initial` and `onMount` stay orthogonal to how the store was got.
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
    // A pure reactive read: `find` returns a stable, reactive handle and the
    // tracked component re-renders on the fields it reads. No effects — the
    // hook never imperatively subscribes, and an in-flight fetch is not
    // cancelled on unmount (it completes and caches).
    //
    // useDocumentStore() returns S which extends DocumentStore<M, Q>; the cast
    // narrows back to the concrete DocumentStore<M, Q> so .find() is callable.
    const store = useDocumentStore() as unknown as DocumentStore<M, Q>;
    // oxlint-disable-next-line no-array-method-this-argument -- DocumentStore#find, not Array#find
    return store.find(type, id);
  }

  function useDocumentsIndividually<K extends keyof M & string>(
    type: K,
    ids: string[] | null | undefined,
  ): Array<DocumentHandle<M[K]>> {
    // Pure reactive read: `findDocumentsIndividually` maps ids → stable per-id
    // handles (re-triggering fetches each render) and returns a FRESH array each
    // call. Hold the previous one and swap only when the handle set actually
    // changes, so React sees a stable array identity while the ids are unchanged.
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
    // Built on the sibling hook: it fetches the per-id handles (re-triggering
    // loads every render, like useDocument) AND keeps the array identity stable
    // while the ids are unchanged — so the batch wrapper (whose promise computed
    // must stay stable for use()/memoization) rebuilds on a plain identity
    // check. `idle` distinguishes `null` ids (an idle handle) from empty ids
    // (immediately success), which share the one stable empty handle array.
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
    // Pure reactive read, like useDocument. Same narrowing cast.
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
