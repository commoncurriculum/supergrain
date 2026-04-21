import type { DocumentTypes, RegisteredTypes } from "../memory";
import type { DocumentHandle, DocumentsHandle, DocumentStore } from "../store";

import { createContext, createElement, useContext, useState, type ReactNode } from "react";

// =============================================================================
// Internal singleton context
// =============================================================================
//
// One document store per app. The Provider populates this shared context;
// the free-standing hooks below read from it. Since the store is created
// per-mount via `useState(init)`, SSR requests and tests remain isolated
// even though the context identity is global.

const DocumentStoreContext = createContext<DocumentStore<DocumentTypes> | null>(null);

// =============================================================================
// DocumentStoreProvider
// =============================================================================

/**
 * Mounts a `DocumentStore` into the React tree. Builds a fresh store on
 * mount via the `init` function, so each Provider instance (per SSR
 * request, per test) gets its own store.
 *
 * @example
 * ```tsx
 * // app/document-store.ts
 * function initStore() {
 *   const finder = new Finder<TypeToModel>({ models: {...} });
 *   return new DocumentStore<TypeToModel>({ finder });
 * }
 *
 * export function Provider({ children }: { children: ReactNode }) {
 *   return (
 *     <DocumentStoreProvider init={initStore}>
 *       {children}
 *     </DocumentStoreProvider>
 *   );
 * }
 * ```
 */
export function DocumentStoreProvider<M extends DocumentTypes = RegisteredTypes>({
  init,
  children,
}: {
  init: () => DocumentStore<M>;
  children: ReactNode;
}): ReactNode {
  const [store] = useState(init);
  return createElement(
    DocumentStoreContext.Provider,
    { value: store as unknown as DocumentStore<DocumentTypes> },
    children,
  );
}

// =============================================================================
// Free-standing hooks
// =============================================================================

/**
 * Escape hatch — read the mounted `DocumentStore` from context.
 *
 * Use for imperative operations that aren't covered by the reactive
 * hooks: `store.insertDocument(doc)`, `store.clearMemory()`, etc. For
 * reads, prefer `useDocument` / `useDocuments` — they subscribe to
 * changes automatically.
 */
export function useDocumentStore<M extends DocumentTypes = RegisteredTypes>(): DocumentStore<M> {
  const store = useContext(DocumentStoreContext);
  if (store === null) {
    throw new Error(
      "@supergrain/document-store/react: useDocumentStore must be used within <DocumentStoreProvider>",
    );
  }
  return store as unknown as DocumentStore<M>;
}

/**
 * Reactive read of a single document by `(type, id)`. Re-renders when the
 * document changes. `null`/`undefined` id returns an idle handle (no fetch).
 */
export function useDocument<
  M extends DocumentTypes = RegisteredTypes,
  K extends keyof M & string = keyof M & string,
>(_type: K, _id: string | null | undefined): DocumentHandle<M[K]> {
  throw new Error("@supergrain/document-store/react: useDocument is not yet implemented");
}

/**
 * Reactive read of many documents by ids. Batches into a single adapter
 * call; returns one aggregate handle. Empty `ids` returns an idle handle.
 */
export function useDocuments<
  M extends DocumentTypes = RegisteredTypes,
  K extends keyof M & string = keyof M & string,
>(_type: K, _ids: ReadonlyArray<string>): DocumentsHandle<M[K]> {
  throw new Error("@supergrain/document-store/react: useDocuments is not yet implemented");
}
