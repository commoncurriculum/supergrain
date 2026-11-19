import { effect } from "@supergrain/kernel";
import { useEffect } from "react";

/**
 * Runs a side effect on mount and re-runs it synchronously whenever a signal
 * it read changes; stopped on unmount. Re-runs don't re-render the component.
 *
 * `fn` is captured on mount: values from later renders are not seen.
 *
 * @param fn - Reads reactive state; may return a cleanup, run before each
 *   re-run and on unmount.
 *
 * @example
 * ```tsx
 * // app/store.ts:
 * //   export const { Provider, useStore } = createStoreContext<AppState>();
 * // app/main.tsx:
 * //   <Provider initial={{ todos: [] as Todo[] }}><App /></Provider>
 *
 * const App = tracked(() => {
 *   const store = useStore()
 *
 *   useSignalEffect(() => {
 *     document.title = `${store.todos.filter(t => !t.completed).length} items left`
 *   })
 *
 *   return <TodoList />
 * })
 * ```
 */
export function useSignalEffect(fn: () => void | (() => void)): void {
  useEffect(() => {
    const cleanup = effect(fn);
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
