import { noteRead } from "@supergrain/kernel/internal";
import { computed } from "alien-signals";
import { useMemo } from "react";

/**
 * A memoized computed inside a component. The component re-renders only when
 * the result changes, not on every change to what `factory` reads.
 *
 * Must be used inside a `tracked()` component.
 *
 * @param factory - Reads reactive state and returns a derived value.
 * @param deps - Like `useMemo` deps: a change creates a new computed. Defaults to `[]`.
 * @returns The current value.
 *
 * @example
 * ```tsx
 * const Row = tracked(({ item }) => {
 *   const store = useStore();
 *   const isSelected = useComputed(() => store.selected === item.id);
 *   return <tr className={isSelected ? 'danger' : ''}> ... </tr>;
 * });
 * ```
 */
export function useComputed<T>(factory: () => T, deps: ReadonlyArray<unknown> = []): T {
  const c = useMemo(() => computed(factory), deps); // eslint-disable-line react-hooks/exhaustive-deps
  noteRead(c);
  return c();
}
