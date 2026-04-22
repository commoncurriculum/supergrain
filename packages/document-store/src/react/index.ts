import type { DocumentTypes, RegisteredTypes } from "../memory";
import type { QueriesHandle, QueryHandle, QueryTypes, RegisteredQueries } from "../queries";
import type { DocumentHandle, DocumentsHandle, DocumentStore } from "../store";

import { createContext, createElement, useContext, useState, type ReactNode } from "react";

// =============================================================================
// createDocumentStoreContext — escape hatch for isolation
// =============================================================================

/**
 * Create an isolated `DocumentStore` React binding — Context + Provider +
 * hooks, all tied to a fresh React Context that doesn't collide with the
 * default singleton or any other call to this factory.
 *
 * Most apps don't need this. Use the free-standing exports
 * (`DocumentStoreProvider`, `useDocument`, etc.) — they're backed by a
 * default context created once at module load.
 *
 * Reach for this factory when you need **isolation**: a library shipping
 * its own document store without colliding with the host app, a
 * micro-frontend that owns its own data layer, or a test harness that
 * mounts alternate data.
 *
 * @example
 * ```ts
 * // in a library
 * const libStore = createDocumentStoreContext<LibTypes>();
 * export const Provider = libStore.Provider;
 * export const useLibDocument = libStore.useDocument;
 * ```
 *
 * Note: the subpath hooks in `@supergrain/document-store/react/json-api`
 * (`useBelongsTo`, `useHasMany`) compose on the **default** `useDocument`.
 * If you need JSON-API hooks bound to your isolated context, compose them
 * yourself on top of `libStore.useDocument` / `libStore.useDocuments`.
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
  useDocuments: <K extends keyof M & string>(
    type: K,
    ids: ReadonlyArray<string>,
  ) => DocumentsHandle<M[K]>;
  useQuery: <K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"] | null | undefined,
  ) => QueryHandle<Q[K]["result"]>;
  useQueries: <K extends keyof Q & string>(
    type: K,
    paramsList: ReadonlyArray<Q[K]["params"]>,
  ) => QueriesHandle<Q[K]["result"]>;
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
        "@supergrain/document-store/react: useDocumentStore must be used within <DocumentStoreProvider>",
      );
    }
    return store;
  }

  function useDocument<K extends keyof M & string>(
    _type: K,
    _id: string | null | undefined,
  ): DocumentHandle<M[K]> {
    // Validates Provider is mounted; implementation will call
    // `store.find(type, id)` on this store reference.
    useDocumentStore();
    throw new Error("@supergrain/document-store/react: useDocument is not yet implemented");
  }

  function useDocuments<K extends keyof M & string>(
    _type: K,
    _ids: ReadonlyArray<string>,
  ): DocumentsHandle<M[K]> {
    useDocumentStore();
    throw new Error("@supergrain/document-store/react: useDocuments is not yet implemented");
  }

  function useQuery<K extends keyof Q & string>(
    _type: K,
    _params: Q[K]["params"] | null | undefined,
  ): QueryHandle<Q[K]["result"]> {
    // Validates Provider is mounted; implementation will call
    // `store.findQuery(type, params)` on this store reference.
    useDocumentStore();
    throw new Error("@supergrain/document-store/react: useQuery is not yet implemented");
  }

  function useQueries<K extends keyof Q & string>(
    _type: K,
    _paramsList: ReadonlyArray<Q[K]["params"]>,
  ): QueriesHandle<Q[K]["result"]> {
    useDocumentStore();
    throw new Error("@supergrain/document-store/react: useQueries is not yet implemented");
  }

  return { Provider, useDocumentStore, useDocument, useDocuments, useQuery, useQueries };
}

// =============================================================================
// Default singleton context
// =============================================================================
//
// One call to the factory, bound at module load. 95% of apps import the
// free-standing exports below and never touch `createDocumentStoreContext`.
// Libraries needing isolation call the factory for their own Context.

const defaultContext = createDocumentStoreContext();

/**
 * Free-standing default exports — bound to a single module-level context.
 * 95% of apps import these and never touch `createDocumentStoreContext`.
 *
 * - `DocumentStoreProvider` mounts the store. Builds a fresh instance on
 *   mount via `init`, so each Provider instance (per SSR request, per
 *   test) gets its own store.
 * - `useDocumentStore` — escape hatch for imperative ops (insertDocument,
 *   insertQueryResult, clearMemory). For reads, prefer the hooks.
 * - `useDocument` — reactive single-doc read by `(type, id)`.
 * - `useDocuments` — reactive batch doc read by `(type, ids)`.
 * - `useQuery` — reactive single-query-result read by `(type, params)`.
 * - `useQueries` — reactive batch query-result read by `(type, paramsList)`.
 */
export const {
  Provider: DocumentStoreProvider,
  useDocumentStore,
  useDocument,
  useDocuments,
  useQuery,
  useQueries,
} = defaultContext;
