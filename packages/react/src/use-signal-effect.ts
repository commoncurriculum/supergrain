import { effect } from "@supergrain/core";
import { useEffect } from "react";

/**
 * Runs a signal-tracked side effect tied to the component lifecycle.
 *
 * The callback runs immediately on mount and re-runs synchronously
 * whenever any signal read inside it changes. The effect is automatically
 * cleaned up when the component unmounts.
 *
 * Re-runs happen outside React's render cycle and do not, on their own,
 * schedule a re-render — only the callback itself runs. Use this for side
 * effects like updating `document.title`, logging, or syncing with external
 * systems. (Compare to `useEffect`, where you would normally call `setState`
 * inside the effect to surface changes back to the UI.)
 *
 * @param fn - A function that reads reactive signals and performs side effects.
 *
 * @example
 * ```tsx
 * const { Provider, useStore } = createStore(() => ({ todos: [] as Todo[] }))
 *
 * const App = tracked(() => {
 *   const store = useStore()
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
  useEffect(() => {
    const cleanup = effect(fn);
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
