import { createReactive } from "@supergrain/kernel";
import { useState } from "react";

/**
 * A reactive object created once per mount, stable across renders.
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const state = useReactive({ count: 0 })
 *   return <button onClick={() => state.count++}>{state.count}</button>
 * }
 * ```
 */
export function useReactive<T extends object>(initialState: T): T {
  const [state] = useState(() => createReactive(initialState));
  return state as T;
}
