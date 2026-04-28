import { createReactive } from "@supergrain/kernel";
import { useState } from "react";

/**
 * Per-component reactive object, scoped to the component's lifetime.
 *
 * Wraps `createReactive` in a `useState` lazy initializer so the proxy is
 * created exactly once per mount and its identity stays stable across renders.
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
  // createReactive returns Branded<T>, which is structurally identical to T
  // (adds only the optional phantom [$BRAND] marker). Cast back to T so
  // consumers can type their state as T without carrying the brand throughout.
  return state as T;
}
