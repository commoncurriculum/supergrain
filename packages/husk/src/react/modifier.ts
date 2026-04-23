import { effect } from "@supergrain/kernel";
import { useCallback, useRef } from "react";

/**
 * A modifier is a function that sets up behavior on a DOM element and
 * returns a cleanup. It's the supergrain counterpart of an Ember modifier:
 * an element-scoped, composable setup/teardown pair.
 *
 * Authored as a plain function:
 * ```ts
 * const onKeydown = modifier<HTMLElement, [string, (e: KeyboardEvent) => void]>(
 *   (el, key, handler) => {
 *     const listener = (e: KeyboardEvent) => { if (e.key === key) handler(e); };
 *     el.addEventListener("keydown", listener);
 *     return () => el.removeEventListener("keydown", listener);
 *   }
 * );
 * ```
 *
 * Applied via `useModifier`:
 * ```tsx
 * <input ref={useModifier(onKeydown, "Enter", () => submit())} />
 * ```
 *
 * The identity function today; branded in types so future versions can
 * attach metadata (e.g. `modifier.update`, `modifier.compose`) without a
 * breaking API change. Users should always go through this factory when
 * authoring a reusable modifier — the brand makes usage discoverable via
 * TypeScript tooling.
 */
export type Modifier<E extends Element, A extends unknown[]> = (
  el: E,
  ...args: A
) => (() => void) | void;

export function modifier<E extends Element, A extends unknown[]>(
  fn: Modifier<E, A>,
): Modifier<E, A> {
  return fn;
}

/**
 * Apply a modifier to an element via a React ref callback.
 *
 * Returns a stable ref callback. On attach, runs the modifier with the
 * current args and tracks any signals read inside setup — the modifier
 * reruns (teardown → setup) when those signals change, without React
 * touching the element. On detach (unmount or element swap), cleanup runs.
 *
 * **Args stability:** `args` are read from a ref on every rerun, so
 * passing a fresh closure each render (e.g. `() => setCount(c => c + 1)`)
 * does NOT re-attach. The modifier's setup sees the latest args when it
 * runs. If you want the modifier to re-attach on arg changes, read the
 * args inside `setup` and combine with a signal, or lift the arg to a
 * signal.
 *
 * **React 19 cleanup ref callbacks** are used — the returned function is
 * the ref callback; its return value is the cleanup React runs on detach.
 *
 * @example Click outside
 * ```tsx
 * const onClickOutside = modifier<HTMLElement, [() => void]>(
 *   (el, onOutside) => {
 *     const handler = (e: MouseEvent) => {
 *       if (!el.contains(e.target as Node)) onOutside();
 *     };
 *     document.addEventListener("click", handler);
 *     return () => document.removeEventListener("click", handler);
 *   }
 * );
 *
 * function Popover({ onClose }: { onClose: () => void }) {
 *   return <div ref={useModifier(onClickOutside, onClose)}>...</div>;
 * }
 * ```
 *
 * @example Reactive input (signals drive rerun)
 * ```tsx
 * const watchSize = modifier<HTMLElement, []>((el) => {
 *   const unit = sizeUnit(); // signal read — rerun on change
 *   // ... use unit in setup ...
 *   return () => { ... };
 * });
 * ```
 */
export function useModifier<E extends Element, A extends unknown[]>(
  m: Modifier<E, A>,
  ...args: A
): (el: E | null) => (() => void) | void {
  const argsRef = useRef<A>(args);
  argsRef.current = args;

  // Stable ref callback. React 19 calls it with an element on attach and
  // invokes the returned cleanup on detach. A stable identity keeps React
  // from tearing down on every render.
  return useCallback(
    (el: E | null) => {
      if (el === null) return;

      // eslint-disable-next-line unicorn/no-null -- sentinel for "no cleanup registered"
      let userCleanup: (() => void) | null = null;
      const stopEffect = effect(() => {
        // Tear down prior run before re-setup.
        if (userCleanup) {
          try {
            userCleanup();
          } catch (error) {
            console.error("[supergrain/modifier] cleanup threw:", error);
          }
          userCleanup = null; // eslint-disable-line unicorn/no-null
        }
        const result = m(el, ...argsRef.current);
        if (typeof result === "function") userCleanup = result;
      });

      return () => {
        stopEffect();
        if (userCleanup) {
          try {
            userCleanup();
          } catch (error) {
            console.error("[supergrain/modifier] cleanup threw:", error);
          }
        }
      };
    },
    // Stable across renders; latest args flow via argsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
