import { createContext, createElement, useContext, type ReactNode } from "react";

import { useReactive } from "./use-reactive";

/**
 * Create a typed store binding — Context + Provider + hook, all tied to a
 * fresh React Context that doesn't collide with any other call to this
 * factory.
 *
 * Call once at module scope, destructure `{ Provider, useStore }`, re-export;
 * components in your app import the pieces they need from your module.
 *
 * The Provider takes an `initial` prop with your plain state shape. The
 * Provider wraps it in `createReactive()` exactly once per mount, so every
 * SSR request, every test, every React tree gets an isolated store by
 * construction — there's no way to accidentally share state across requests.
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
 *
 * For non-React use, import `createReactive` from `@supergrain/kernel` directly.
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
