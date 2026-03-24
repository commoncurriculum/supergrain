import { effect } from "@supergrain/core";
import { useEffect } from "react";

/**
 * Runs a signal-tracked side effect tied to the component lifecycle.
 *
 * The callback runs immediately on mount and re-runs whenever any
 * signal read inside it changes. The effect is automatically cleaned
 * up when the component unmounts.
 *
 * Unlike React's `useEffect`, this does NOT cause the component to
 * re-render — it runs the callback directly outside the React render
 * cycle. Use this for side effects like updating `document.title`,
 * logging, or syncing with external systems.
 *
 * @param fn - A function that reads reactive signals and performs side effects.
 *
 * @example
 * ```tsx
 * const Store = provideStore(store)
 *
 * const App = tracked(() => {
 *   const store = Store.useStore()
 *   const remaining = useComputed(() => store.todos.filter(t => !t.completed).length)
 *
 *   useSignalEffect(() => {
 *     document.title = `${remaining} items left`
 *   })
 *
 *   return <TodoList />
 * })
 * ```
 */
export function useSignalEffect(fn: () => void): void {
  // Empty deps is intentional: the signal effect tracks its own reactive
  // dependencies via alien-signals. Stale closures are not a concern because
  // callbacks read from store proxies whose references are stable — the proxy
  // always returns the latest value regardless of when the closure was created.
  useEffect(() => {
    const cleanup = effect(fn);
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
