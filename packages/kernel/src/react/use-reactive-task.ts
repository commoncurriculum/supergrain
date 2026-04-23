import { useMemo } from "react";

import { reactiveTask, type ReactiveTask } from "../async";

/**
 * Creates a `reactiveTask` scoped to the component lifecycle. The task
 * identity is stable across renders when `deps` don't change, so passing
 * it to children or effect deps is safe.
 *
 * @example
 * ```tsx
 * const EditForm = tracked(({ id }: { id: string }) => {
 *   const save = useReactiveTask((name: string) => api.saveUser(id, name), [id]);
 *   return <>
 *     <button onClick={() => save.run(draftName)} disabled={save.isPending}>Save</button>
 *     {save.error ? <span>{String(save.error)}</span> : null}
 *   </>;
 * });
 * ```
 */
export function useReactiveTask<Args extends unknown[], T>(
  asyncFn: (...args: Args) => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): ReactiveTask<Args, T> {
  return useMemo(() => reactiveTask(asyncFn), deps); // eslint-disable-line react-hooks/exhaustive-deps
}
