import { useDisposeOnUnmount } from "@supergrain/kernel/react";
import { useMemo } from "react";

import { dispose, resource, type ResourceContext, type ResourceFactory } from "../resource";

type SetupResult = void | (() => void) | Promise<void>;

/**
 * Component-scoped resource. Two shapes, same hook.
 *
 * **Inline** — `useResource(initial, setup)`: reactive reads inside
 * `setup` drive reruns.
 *
 * ```tsx
 * const Editor = tracked(() => {
 *   const store = useStore();
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
 *   const store = useStore();
 *   const user = useResource(fetchUser, () => store.selectedUserId);
 *   return user.isPending ? <Spinner /> : <UserCard user={user.data!} />;
 * });
 * ```
 *
 * Disposed on unmount.
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
    // Created once; reactivity comes from argsFn/setup, not React deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useDisposeOnUnmount(() => dispose(instance));
  return instance;
}
