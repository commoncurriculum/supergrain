import { createContext, createElement, useContext, type ReactNode } from "react";

/**
 * Wraps an existing store with React context plumbing.
 *
 * Takes a store proxy from `createStore` and returns an object with:
 * - `Provider` — a React component that makes the store available to descendants (no props needed)
 * - `useStore()` — a hook that returns the store from context
 *
 * The store is pre-bound to the Provider, so there's no `store` prop to pass.
 * Because the proxy's identity never changes, the context value is stable
 * and won't trigger React re-renders.
 *
 * @example
 * ```tsx
 * import { createStore } from '@supergrain/core'
 * import { provideStore } from '@supergrain/react'
 *
 * const store = createStore<AppState>({ todos: [], selected: null })
 * const Store = provideStore(store)
 *
 * // root
 * <Store.Provider><App /></Store.Provider>
 *
 * // any component
 * const store = Store.useStore()
 * ```
 */
export function provideStore<T>(store: T): {
  Provider: (props: { children: ReactNode }) => ReactNode;
  useStore: () => T;
} {
  const Context = createContext<T | null>(null);

  // children is intentionally required — a Provider without children is a no-op.
  function Provider({ children }: { children: ReactNode }) {
    return createElement(Context.Provider, { value: store }, children);
  }

  function useStore(): T {
    const value = useContext(Context);
    if (value === null) {
      throw new Error("useStore must be used within its Provider");
    }
    return value;
  }

  return { Provider, useStore };
}
