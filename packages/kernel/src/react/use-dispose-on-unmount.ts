import { useEffect, useRef } from "react";

// Minimal local declaration so this file doesn't require @types/node in
// downstream packages. Consumer bundlers (and Vite library mode) replace
// `process.env.NODE_ENV` based on their build, which is what we want.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Run `cleanup` when the component truly unmounts.
 *
 * In production the cleanup runs synchronously on unmount. In
 * development it defers via `setTimeout(0)` to survive React 18
 * StrictMode's mount→cleanup→remount cycle: the remount fires the
 * effect again and clears the pending timer; on a real unmount the
 * timer survives and runs the cleanup.
 *
 * Hooks are always called unconditionally — the dev/prod branch is
 * inside the effect cleanup, so Rules of Hooks holds even if the
 * `process.env.NODE_ENV` literal is somehow not replaced by a
 * downstream bundler. Vite library mode preserves the literal in this
 * package's compiled dist; consumer bundlers (Vite, webpack, esbuild,
 * Rollup with terser) replace it at their build time, allowing the
 * minifier to DCE the dev path in production.
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
      if (process.env.NODE_ENV === "production") {
        cleanupRef.current();
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        cleanupRef.current();
      }, 0);
    };
  }, []);
}
