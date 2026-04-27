import { useEffect, useRef } from "react";

/**
 * Run `cleanup` when the component truly unmounts, but survive React 18
 * StrictMode's dev-only mount→cleanup→remount cycle.
 *
 * Schedules `cleanup` on a `setTimeout(0)` macrotask in the effect's
 * cleanup phase, and cancels the timer if the effect runs again
 * (StrictMode remount). On a real unmount the timer survives and fires.
 *
 * Microtasks aren't safe here — they can drain between StrictMode
 * cleanup and remount, prematurely running the cleanup.
 *
 * @example
 * ```ts
 * useDisposeOnUnmount(() => dispose(instance));
 * ```
 */
export function useDisposeOnUnmount(cleanup: () => void): void {
  const cleanupRef = useRef(cleanup);
  cleanupRef.current = cleanup;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        cleanupRef.current();
      }, 0);
    };
  }, []);
}
