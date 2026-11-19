import { createContext, createElement, useContext, type ReactNode } from "react";

import { useReactive } from "./use-reactive";

/**
 * Create a typed store binding: a Provider and a `useStore` hook on a fresh
 * React Context. Call once at module scope and re-export the pieces.
 *
 * The Provider wraps its `initial` prop in `createReactive()` once per mount,
 * so each React tree (each SSR request, each test) gets its own store.
 *
 * @example
 * ```tsx
 * // src/stores/app.ts
 * import { createStoreContext } from "@supergrain/kernel/react";
 *
 * interface AppState {
 *   todos: Todo[];
 *   selected: number | null;
 * }
 *
 * export const { Provider, useStore } = createStoreContext<AppState>();
 *
 * // src/App.tsx
 * import { Provider } from "./stores/app";
 *
 * <Provider initial={{ todos: [], selected: null }}>
 *   <Routes />
 * </Provider>;
 *
 * // src/components/TodoItem.tsx
 * import { useStore } from "../stores/app";
 * const state = useStore(); // : AppState
 * state.todos.push({ id: 1, text: "hi", completed: false });
 * ```
 */
export function createStoreContext<T extends object>(): {
  Provider: (props: { initial: T; children: ReactNode }) => ReactNode;
  useStore: () => T;
} {
  const Context = createContext<T | null>(null);

  function Provider({ initial, children }: { initial: T; children: ReactNode }): ReactNode {
    const state = useReactive(initial);
    return createElement(Context.Provider, { value: state }, children);
  }

  function useStore(): T {
    const value = useContext(Context);
    if (value === null) {
      throw new Error(
        "@supergrain/kernel/react: useStore must be used within the Provider returned by createStoreContext()",
      );
    }
    return value;
  }

  return { Provider, useStore };
}
