import { useEffect, useMemo } from "react";

import { reactivePromise, type ReactivePromise } from "../async";
import { dispose } from "../resource";

/**
 * Component-scoped `reactivePromise`. Reactive reads in `asyncFn`'s
 * sync prefix drive reruns; `abortSignal` cancels the previous run on
 * rerun or unmount.
 *
 * @example
 * ```tsx
 * const UserCard = tracked(() => {
 *   const store = useGranary();
 *   const user = useReactivePromise(async (signal) => {
 *     const res = await fetch(`/users/${store.selectedUserId}`, { signal });
 *     return res.json() as Promise<User>;
 *   });
 *   if (user.isPending && !user.isReady) return <Spinner />;
 *   if (user.error) return <ErrorMessage error={user.error} />;
 *   return <div>{user.data!.name}</div>;
 * });
 * ```
 */
export function useReactivePromise<T>(
  asyncFn: (abortSignal: AbortSignal) => Promise<T>,
): ReactivePromise<T> {
  const rp = useMemo(
    () => reactivePromise(asyncFn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => dispose(rp), [rp]);
  return rp;
}
