import { createContext, createElement, useContext, type ReactNode } from "react";

import { useGrain } from "./use-grain";

/**
 * Create a typed store binding — Context + Provider + hook, all tied to a
 * fresh React Context that doesn't collide with any other call to this
 * factory.
 *
 * Call once at module scope, destructure `{ Provider, useGranary }`, re-export;
 * components in your app import the pieces they need from your module.
 *
 * The Provider takes an `initial` prop with your plain state shape. The
 * Provider wraps it in `createGrain()` exactly once per mount, so every
 * SSR request, every test, every React tree gets an isolated store by
 * construction — there's no way to accidentally share state across requests.
 *
 * @example
 * ```tsx
 * // src/stores/app.ts
 * import { createGranaryContext } from "@supergrain/kernel/react";
 *
 * interface AppState {
 *   todos: Todo[];
 *   selected: number | null;
 * }
 *
 * export const { Provider, useGranary } = createGranaryContext<AppState>();
 *
 * // src/App.tsx
 * import { Provider } from "./stores/app";
 *
 * <Provider initial={{ todos: [], selected: null }}>
 *   <Routes />
 * </Provider>;
 *
 * // src/components/TodoItem.tsx
 * import { useGranary } from "../stores/app";
 * const state = useGranary(); // : AppState
 * state.todos.push({ id: 1, text: "hi", completed: false });
 * ```
 *
 * For non-React use, import `createGrain` from `@supergrain/kernel` directly.
 */
export function createGranaryContext<T extends object>(): {
  Provider: (props: { initial: T; children: ReactNode }) => ReactNode;
  useGranary: () => T;
} {
  const Context = createContext<T | null>(null);

  function Provider({ initial, children }: { initial: T; children: ReactNode }): ReactNode {
    const state = useGrain(initial);
    return createElement(Context.Provider, { value: state }, children);
  }

  function useGranary(): T {
    const value = useContext(Context);
    if (value === null) {
      throw new Error(
        "@supergrain/kernel/react: useGranary must be used within the Provider returned by createGranaryContext()",
      );
    }
    return value;
  }

  return { Provider, useGranary };
}
