import { useMemo, useRef } from "react";

import { reactiveTask, type ReactiveTask } from "../async";

/**
 * Component-scoped `reactiveTask`. Task identity is stable across
 * renders (safe to pass to children or effect deps). The `asyncFn`
 * closure is refreshed on each render via a ref, so closed-over
 * React values stay current.
 *
 * @example
 * ```tsx
 * const EditForm = tracked(({ id }: { id: string }) => {
 *   const save = useReactiveTask((name: string) => api.saveUser(id, name));
 *   return (
 *     <button onClick={() => save.run(draftName)} disabled={save.isPending}>
 *       Save
 *     </button>
 *   );
 * });
 * ```
 */
export function useReactiveTask<Args extends unknown[], T>(
  asyncFn: (...args: Args) => Promise<T>,
): ReactiveTask<Args, T> {
  const fnRef = useRef(asyncFn);
  fnRef.current = asyncFn;
  return useMemo(
    () => reactiveTask<Args, T>((...args: Args) => fnRef.current(...args)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
