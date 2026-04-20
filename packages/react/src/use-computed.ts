import { computed } from "@supergrain/core";
import { useMemo } from "react";

/**
 * Creates a memoized computed signal inside a React component.
 *
 * The computed acts as a "firewall" — it subscribes to the signals read
 * inside the factory function, but only notifies downstream (triggering
 * a re-render) when the **result** changes. This means 998 rows that
 * derive `false` from `store.selected === id` won't re-render when
 * selection changes — only the 2 rows whose result flips.
 *
 * Must be used inside a `tracked()` component so the component's effect
 * subscribes to the computed (not directly to the upstream signals).
 *
 * @param factory - A function that reads reactive signals and returns a derived value.
 * @param deps - Optional dependency array (like useMemo). When deps change,
 *               a new computed is created. Defaults to empty array.
 * @returns The current value of the computed.
 *
 * @example
 * ```tsx
 * const Row = tracked(({ item }) => {
 *   const store = Store.useStore();
 *   const isSelected = useComputed(() => store.selected === item.id);
 *   return <tr className={isSelected ? 'danger' : ''}> ... </tr>;
 * });
 * ```
 */
export function useComputed<T>(factory: () => T, deps: ReadonlyArray<unknown> = []): T {
  const c = useMemo(() => computed(factory), deps); // eslint-disable-line react-hooks/exhaustive-deps
  return c();
}
