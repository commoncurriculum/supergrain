import { effect } from "@supergrain/kernel";
import { useCallback, useRef } from "react";

/**
 * A behavior is a function that sets up behavior on a DOM element and
 * returns a cleanup. It's the supergrain counterpart of an Ember behavior:
 * an element-scoped, composable setup/teardown pair.
 *
 * Authored as a plain function:
 * ```ts
 * const onKeydown = behavior<HTMLElement, [string, (e: KeyboardEvent) => void]>(
 *   (el, key, handler) => {
 *     const listener = (e: KeyboardEvent) => { if (e.key === key) handler(e); };
 *     el.addEventListener("keydown", listener);
 *     return () => el.removeEventListener("keydown", listener);
 *   }
 * );
 * ```
 *
 * Applied via `useBehavior`:
 * ```tsx
 * <input ref={useBehavior(onKeydown, "Enter", () => submit())} />
 * ```
 *
 * Currently the identity function. Reusable modifiers should still be
 * authored through this factory so future versions can attach metadata
 * (e.g. `behavior.update`, `behavior.compose`) without requiring call-site
 * changes.
 */
export type Behavior<E extends Element, A extends unknown[]> = (
  el: E,
  ...args: A
) => (() => void) | void;

export function behavior<E extends Element, A extends unknown[]>(
  fn: Behavior<E, A>,
): Behavior<E, A> {
  return fn;
}

/**
 * Apply a behavior to an element via a React ref callback.
 *
 * Returns a stable ref callback. On attach, runs the behavior with the
 * current args and tracks any signals read inside setup — the behavior
 * reruns (teardown → setup) when those signals change, without React
 * touching the element. On detach (unmount or element swap), cleanup runs.
 *
 * **Args stability:** `args` are read from a ref on every rerun, so
 * passing a fresh closure each render (e.g. `() => setCount(c => c + 1)`)
 * does NOT re-attach. The behavior's setup sees the latest args when it
 * runs. If you want the behavior to re-attach on arg changes, read the
 * args inside `setup` and combine with a signal, or lift the arg to a
 * signal.
 *
 * **React 18 & 19** — a stable callback ref; detach is detected via
 * `el === null` rather than React 19's cleanup-returning ref.
 *
 * **Behavior identity** — `m` is read from a ref, matching `args`. Passing
 * a different behavior on a later render does NOT tear down and re-run;
 * the next rerun (via signal change or args change) picks up the latest.
 * In practice modifiers are module-scope constants, so identity is stable.
 *
 * @example Click outside
 * ```tsx
 * const onClickOutside = behavior<HTMLElement, [() => void]>(
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
 *   return <div ref={useBehavior(onClickOutside, onClose)}>...</div>;
 * }
 * ```
 *
 * @example Reactive input (signals drive rerun)
 * ```tsx
 * const watchSize = behavior<HTMLElement, []>((el) => {
 *   const unit = sizeUnit(); // signal read — rerun on change
 *   // ... use unit in setup ...
 *   return () => { ... };
 * });
 * ```
 */
export function useBehavior<E extends Element, A extends unknown[]>(
  m: Behavior<E, A>,
  ...args: A
): (el: E | null) => void {
  const argsRef = useRef<A>(args);
  argsRef.current = args;

  const behaviorRef = useRef<Behavior<E, A>>(m);
  behaviorRef.current = m;

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
      console.error("[supergrain/behavior] cleanup threw:", error);
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

  // Stable callback ref. React 18 & 19 both call with an element on attach
  // and `null` on detach. Stable identity avoids tearing down on every
  // render; `m` and `args` flow through refs.
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
        const result = behaviorRef.current(el, ...argsRef.current);
        if (typeof result === "function") userCleanupRef.current = result;
      });
    },
    [teardown, runUserCleanup],
  );
}
