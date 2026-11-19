import { effect } from "@supergrain/kernel";
import { useCallback, useRef } from "react";

/**
 * A modifier sets up behavior on a DOM element and returns a cleanup,
 * like an Ember modifier.
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
 * Returns a stable ref callback. On attach, runs the modifier and tracks
 * signals read inside it; it reruns (cleanup, then setup) when they change.
 * On detach (unmount or element swap), cleanup runs.
 *
 * `args` and `m` are read from refs: changing them does NOT re-run the
 * modifier, but the next signal-triggered rerun sees the latest values.
 * To re-run on an arg change, lift that arg into a signal.
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
): (el: E | null) => void {
  const argsRef = useRef<A>(args);
  argsRef.current = args;

  const modifierRef = useRef<Modifier<E, A>>(m);
  modifierRef.current = m;

  // eslint-disable-next-line unicorn/no-null -- sentinel for "not attached"
  const elementRef = useRef<E | null>(null);
  // eslint-disable-next-line unicorn/no-null -- sentinel for "no effect running"
  const stopEffectRef = useRef<(() => void) | null>(null);
  // eslint-disable-next-line unicorn/no-null -- sentinel for "no cleanup registered"
  const userCleanupRef = useRef<(() => void) | null>(null);

  const runUserCleanup = useCallback(() => {
    if (!userCleanupRef.current) return;
    try {
      userCleanupRef.current();
    } catch (error) {
      console.error("[supergrain/modifier] cleanup threw:", error);
    }
    userCleanupRef.current = null; // eslint-disable-line unicorn/no-null
  }, []);

  const teardown = useCallback(() => {
    if (stopEffectRef.current) {
      stopEffectRef.current();
      stopEffectRef.current = null; // eslint-disable-line unicorn/no-null
    }
    runUserCleanup();
    elementRef.current = null; // eslint-disable-line unicorn/no-null
  }, [runUserCleanup]);

  // React 18 and 19 call ref callbacks with `null` on detach. A new callback
  // identity would make React detach/re-attach on every render.
  return useCallback(
    (el: E | null) => {
      if (el === null) {
        teardown();
        return;
      }
      if (elementRef.current === el) return;

      teardown();
      elementRef.current = el;
      stopEffectRef.current = effect(() => {
        runUserCleanup();
        const result = modifierRef.current(el, ...argsRef.current);
        if (typeof result === "function") userCleanupRef.current = result;
      });
    },
    [teardown, runUserCleanup],
  );
}
