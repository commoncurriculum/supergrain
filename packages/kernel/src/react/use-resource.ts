import { resource, dispose, type ResourceContext } from "@supergrain/kernel";
import { useEffect, useMemo } from "react";

/**
 * Creates a `resource` scoped to the component lifecycle. Disposes on
 * unmount (aborting in-flight work, running cleanups) and rebuilds when
 * `deps` change.
 *
 * Pass `deps` for non-signal values that should invalidate the whole
 * resource (e.g. a prop that changes the shape of the setup). Signal
 * reads inside `setup` are tracked automatically — don't put them in
 * `deps`.
 *
 * @example Clock
 * ```tsx
 * const Clock = tracked(() => {
 *   const now = useResource({ value: Date.now() }, (state) => {
 *     const id = setInterval(() => { state.value = Date.now(); }, 1000);
 *     return () => clearInterval(id);
 *   });
 *   return <time>{new Date(now.value).toLocaleTimeString()}</time>;
 * });
 * ```
 *
 * @example Async fetch
 * ```tsx
 * const Profile = tracked(({ id }: { id: string }) => {
 *   const user = useResource(
 *     { data: null as User | null, error: null as Error | null, isLoading: true },
 *     async (state, { abortSignal }) => {
 *       try {
 *         const res = await fetch(`/users/${id}`, { signal: abortSignal });
 *         state.data = await res.json();
 *       } catch (e) {
 *         state.error = e as Error;
 *       } finally {
 *         state.isLoading = false;
 *       }
 *     },
 *     [id],
 *   );
 *   if (user.isLoading) return <Spinner />;
 *   if (user.error) return <ErrorMessage error={user.error} />;
 *   return <UserCard user={user.data!} />;
 * });
 * ```
 */
export function useResource<T extends object>(
  initial: T,
  setup: (state: T, ctx: ResourceContext) => void | (() => void) | Promise<void>,
  deps: ReadonlyArray<unknown> = [],
): T {
  const state = useMemo(() => resource(initial, setup), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => dispose(state), [state]);
  return state;
}
