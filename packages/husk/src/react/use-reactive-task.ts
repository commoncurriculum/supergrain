import { useDisposeOnUnmount } from "@supergrain/kernel/react";
import { type Effect } from "effect";
import { useMemo, useRef } from "react";

import { reactiveTask, type ReactiveTask } from "../async";
import { dispose } from "../resource";

/**
 * Component-scoped `reactiveTask`. Task identity is stable across
 * renders (safe to pass to children or effect deps). The `effectFn`
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
export function useReactiveTask<Args extends unknown[], T, E = unknown>(
  effectFn: (...args: Args) => Effect.Effect<T, E>,
): ReactiveTask<Args, T, E> {
  const fnRef = useRef(effectFn);
  fnRef.current = effectFn;
  const task = useMemo(
    () => reactiveTask<Args, T, E>((...args: Args) => fnRef.current(...args)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useDisposeOnUnmount(() => dispose(task));
  return task;
}
