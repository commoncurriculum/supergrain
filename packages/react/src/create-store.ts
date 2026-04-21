import { createReactive } from "@supergrain/core";
import { createContext, createElement, useContext, useState, type ReactNode } from "react";

// =============================================================================
// createStoreContext — escape hatch for isolation
// =============================================================================

/**
 * Create an isolated reactive store binding — Context + Provider + hook,
 * all tied to a fresh React Context that doesn't collide with the default
 * singleton or any other call to this factory.
 *
 * Most apps don't need this. Use the free-standing exports (`StoreProvider`
 * + `useStore`) — they're backed by a default context created once at
 * module load.
 *
 * Reach for this factory when you need **isolation**: a library shipping
 * its own reactive state without colliding with the host app, a
 * micro-frontend that owns its own state tree, or a test harness that
 * mounts alternate state.
 *
 * @example
 * ```ts
 * // in a library
 * const libState = createStoreContext<LibState>();
 * export const Provider = libState.Provider;
 * export const useLibState = libState.useStore;
 * ```
 *
 * Creating the store per-mount (rather than per-module-load) is what makes
 * this safe for SSR and tests: each request renders its own Provider, so
 * request A can never see request B's state, and each test gets a clean
 * store.
 */
export function createStoreContext<T extends object>(): {
  Provider: (props: { init: () => T; children: ReactNode }) => ReactNode;
  useStore: () => T;
} {
  const Context = createContext<T | null>(null);

  function Provider({ init, children }: { init: () => T; children: ReactNode }): ReactNode {
    const [state] = useState(() => createReactive(init()));
    return createElement(Context.Provider, { value: state as T }, children);
  }

  function useStore(): T {
    const value = useContext(Context);
    if (value === null) {
      throw new Error("@supergrain/react: useStore must be used within <StoreProvider>");
    }
    return value;
  }

  return { Provider, useStore };
}

// =============================================================================
// Default singleton context
// =============================================================================
//
// One call to the factory, bound at module load. 95% of apps import the
// free-standing exports below and never touch `createStoreContext`.
// Libraries needing isolation call the factory for their own Context.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defaultContext = createStoreContext<any>();

/**
 * Mounts an app-wide reactive store into the React tree. Builds a fresh
 * store on mount via the `init` function, so each Provider instance (per
 * SSR request, per test) gets its own store.
 *
 * @example
 * ```tsx
 * // store.ts
 * function initState() {
 *   return { todos: [] as Todo[], user: null as User | null };
 * }
 *
 * export function Provider({ children }: { children: ReactNode }) {
 *   return <StoreProvider init={initState}>{children}</StoreProvider>;
 * }
 * ```
 */
export function StoreProvider<T>({
  init,
  children,
}: {
  init: () => T;
  children: ReactNode;
}): ReactNode {
  return createElement(defaultContext.Provider, { init, children });
}

/**
 * Read the mounted reactive store from context. Throws when used outside
 * of `<StoreProvider>`.
 *
 * @example
 * ```tsx
 * const state = useStore<AppState>();
 * state.todos.push(...);
 * ```
 */
export function useStore<T>(): T {
  return defaultContext.useStore() as T;
}
