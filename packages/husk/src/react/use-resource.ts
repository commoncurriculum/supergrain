import { useEffect, useMemo } from "react";

import { dispose, resource, type ResourceContext, type ResourceFactory } from "../resource";

type SetupResult = void | (() => void) | Promise<void>;

/**
 * Component-scoped resource. Two shapes, same hook.
 *
 * **Inline** — `useResource(initial, setup)`: one-off, reactive reads
 * inside `setup` drive reruns. Use when the setup IS the work.
 *
 * ```tsx
 * const Editor = tracked(() => {
 *   const store = useGranary();
 *   const cursor = useResource(
 *     { x: 0, y: 0 },
 *     (state, { onCleanup }) => {
 *       if (!store.trackMouse) return;
 *       const h = (e: MouseEvent) => { state.x = e.clientX; state.y = e.clientY; };
 *       window.addEventListener("mousemove", h);
 *       onCleanup(() => window.removeEventListener("mousemove", h));
 *     },
 *   );
 *   return <Crosshair x={cursor.x} y={cursor.y} />;
 * });
 * ```
 *
 * **Factory** — `useResource(factory, argsFn?)`: binds a
 * `defineResource` factory; the thunk's reactive reads drive reruns.
 *
 * ```tsx
 * const Profile = tracked(() => {
 *   const store = useGranary();
 *   const user = useResource(fetchUser, () => store.selectedUserId);
 *   return user.isPending ? <Spinner /> : <UserCard user={user.data!} />;
 * });
 * ```
 *
 * Disposes on unmount (aborts in-flight work, runs cleanups, halts
 * the effect).
 */
export function useResource<T extends object>(
  initial: T,
  setup: (state: T, ctx: ResourceContext) => SetupResult,
): T;
export function useResource<T extends object>(factory: ResourceFactory<void, T>): T;
export function useResource<Args, T extends object>(
  factory: ResourceFactory<Args, T>,
  argsFn: () => Args,
): T;
export function useResource(first: unknown, second?: unknown): object {
  const instance = useMemo(() => {
    if (typeof first === "function") {
      const factory = first as (argsFn?: () => unknown) => object;
      return second ? factory(second as () => unknown) : factory();
    }
    return resource(
      first as object,
      second as (state: object, ctx: ResourceContext) => SetupResult,
    );
    // Deps are intentionally empty: the resource identity is stable,
    // and the argsFn/setup closures provide the reactive surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => dispose(instance), [instance]);
  return instance;
}
