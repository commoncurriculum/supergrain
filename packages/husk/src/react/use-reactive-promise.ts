import { useDisposeOnUnmount } from "@supergrain/kernel/react";
import { type Effect } from "effect";
import { useMemo } from "react";

import { reactivePromise, type ReactivePromise } from "../async";
import { dispose } from "../resource";

/**
 * Component-scoped `reactivePromise`. Reactive reads in `effectFn`'s
 * thunk body drive reruns; the previous run is interrupted on rerun or
 * unmount.
 *
 * @example
 * ```tsx
 * const UserCard = tracked(() => {
 *   const store = useStore();
 *   const user = useReactivePromise(() =>
 *     Effect.tryPromise(
 *       () => fetch(`/users/${store.selectedUserId}`).then((r) => r.json()) as Promise<User>,
 *     ),
 *   );
 *   if (user.isPending && !user.isReady) return <Spinner />;
 *   if (user.error) return <ErrorMessage error={user.error} />;
 *   return <div>{user.data!.name}</div>;
 * });
 * ```
 */
export function useReactivePromise<T, E = unknown>(
  effectFn: () => Effect.Effect<T, E>,
): ReactivePromise<T, E> {
  const rp = useMemo(
    () => reactivePromise(effectFn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useDisposeOnUnmount(() => dispose(rp));
  return rp;
}
