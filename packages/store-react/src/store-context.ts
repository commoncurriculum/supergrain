import type { DocumentHandle, DocumentTypes, Store } from "@supergrain/store";

import { type ReactNode, createContext, createElement, useContext, type Context } from "react";

// =============================================================================
// StoreContext — binds a Store<M> to React
// =============================================================================

/**
 * Binds a `Store<M>` to React.
 *
 * Construct one per store at app boot, then use `Provider` to mount it
 * and `useStore` / `useDocument` inside components.
 *
 * @example
 * ```tsx
 * const storeContext = new StoreContext(store);
 *
 * <storeContext.Provider>
 *   <App />
 * </storeContext.Provider>
 *
 * // Inside a component:
 * const handle = storeContext.useDocument("user", userId);
 * ```
 */
export class StoreContext<M extends DocumentTypes> {
  #context: Context<Store<M> | null>;
  #store: Store<M>;

  constructor(store: Store<M>) {
    this.#store = store;
    this.#context = createContext<Store<M> | null>(null);
  }

  /** React Provider that exposes the underlying store to descendants. */
  Provider = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(this.#context.Provider, { value: this.#store }, children);

  /** Read the underlying store from context. Throws if used outside the Provider. */
  useStore = (): Store<M> => {
    const value = useContext(this.#context);
    if (value === null) {
      throw new Error("@supergrain/store-react: useStore must be used within its Provider");
    }
    return value;
  };

  /**
   * Read a document by (type, id) as a reactive handle.
   * Internally calls `store.find` — checks memory, fetches via finder
   * if needed. Re-renders when the document changes.
   */
  useDocument = <K extends keyof M & string>(
    _type: K,
    _id: string | null | undefined,
  ): DocumentHandle<M[K]> => {
    throw new Error("@supergrain/store-react: StoreContext.useDocument is not yet implemented");
  };
}
