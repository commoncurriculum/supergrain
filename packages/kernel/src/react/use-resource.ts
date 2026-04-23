import { resource, type Resource, type ResourceContext } from "@supergrain/kernel";
import { useEffect, useMemo } from "react";

/**
 * Creates a `resource` scoped to the component lifecycle. Disposes the
 * underlying effect (running cleanups, aborting in-flight work) when the
 * component unmounts or when `deps` change.
 *
 * Pass `deps` for non-signal values that should invalidate the whole
 * resource (e.g. a prop that changes the shape of the setup). Signal reads
 * inside `setup` are tracked automatically — don't put them in `deps`.
 *
 * This is the general-purpose equivalent of `useReactivePromise`. Use it
 * for timers, observers, subscriptions, or any stateful effect whose value
 * you want to read reactively. For async data fetches specifically,
 * `useReactivePromise` is shorter (ergonomic sugar around the same idea).
 *
 * @example Clock
 * ```tsx
 * const Clock = tracked(() => {
 *   const now = useResource(Date.now(), ({ set, onCleanup }) => {
 *     const id = setInterval(() => set(Date.now()), 1000);
 *     onCleanup(() => clearInterval(id));
 *   });
 *   return <time>{new Date(now.value).toLocaleTimeString()}</time>;
 * });
 * ```
 *
 * @example Media query listener
 * ```tsx
 * const useIsDark = () => useResource(
 *   matchMedia("(prefers-color-scheme: dark)").matches,
 *   ({ set }) => {
 *     const mql = matchMedia("(prefers-color-scheme: dark)");
 *     const handler = () => set(mql.matches);
 *     mql.addEventListener("change", handler);
 *     return () => mql.removeEventListener("change", handler);
 *   }
 * );
 * ```
 */
export function useResource<T>(
  initial: T,
  setup: (ctx: ResourceContext<T>) => void | (() => void) | Promise<void | (() => void)>,
  deps: ReadonlyArray<unknown> = [],
): Resource<T> {
  const r = useMemo(() => resource(initial, setup), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => r.dispose(), [r]);
  return r;
}
