import { useEffect, useRef } from "react";

// Minimal local declaration so this file doesn't require @types/node in
// downstream packages. Consumer bundlers (and Vite library mode) replace
// `process.env.NODE_ENV` based on their build, which is what we want.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Run `cleanup` when the component truly unmounts.
 *
 * In production this is a plain useEffect cleanup — no overhead. In
 * development it defers via `setTimeout(0)` to survive React 18
 * StrictMode's mount→cleanup→remount cycle: the remount fires the
 * effect again and clears the pending timer; on a real unmount the
 * timer survives and runs the cleanup.
 *
 * The `process.env.NODE_ENV` check is preserved as a literal in this
 * library's compiled dist (Vite library mode behavior); the consumer's
 * bundler replaces it at their build time, so dev-mode StrictMode
 * safety is preserved for downstream consumers running their own dev
 * server.
 *
 * @example
 * ```ts
 * useDisposeOnUnmount(() => dispose(instance));
 * ```
 */
export function useDisposeOnUnmount(cleanup: () => void): void {
  const cleanupRef = useRef(cleanup);
  cleanupRef.current = cleanup;

  /* c8 ignore start -- production-only branch is selected by consumer build-time env replacement */
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- branch is constant per build; bundler DCEs the dev path.
    useEffect(() => () => cleanupRef.current(), []);
    return;
  }
  /* c8 ignore stop */

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
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
