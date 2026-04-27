import { createGrain } from "@supergrain/kernel";
import { useState } from "react";

/**
 * Per-component reactive object, scoped to the component's lifetime.
 *
 * Wraps `createGrain` in a `useState` lazy initializer so the proxy is
 * created exactly once per mount and its identity stays stable across renders.
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const state = useGrain({ count: 0 })
 *   return <button onClick={() => state.count++}>{state.count}</button>
 * }
 * ```
 */
export function useGrain<T extends object>(initialState: T): T {
  const [state] = useState(() => createGrain(initialState));
  return state as T;
}
