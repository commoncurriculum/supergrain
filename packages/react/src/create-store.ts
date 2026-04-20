import { createReactive } from "@supergrain/core";
import { createContext, createElement, useContext, useState, type ReactNode } from "react";

/**
 * Creates an app-wide reactive store scoped to a React subtree.
 *
 * Call at module scope with an initializer function; returns a `Provider`
 * that builds a fresh store on mount and a `useStore` hook that reads it
 * from context.
 *
 * Creating the store per mount (rather than per module load) is what makes
 * this safe for SSR and tests: each request renders its own Provider, so
 * request A can never see request B's state, and each test gets a clean store.
 *
 * @example
 * ```tsx
 * // store.ts
 * export const { Provider, useStore } = createStore(() => ({
 *   todos: [] as Todo[],
 *   user: null as User | null,
 * }))
 *
 * // root.tsx
 * <Provider><App /></Provider>
 *
 * // any component
 * const state = useStore()
 * state.todos.push(...)
 * ```
 */
export function createStore<T extends object>(
  initialState: () => T,
): {
  Provider: (props: { children: ReactNode }) => ReactNode;
  useStore: () => T;
} {
  const Context = createContext<T | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const [state] = useState(() => createReactive(initialState()));
    return createElement(Context.Provider, { value: state as T }, children);
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
