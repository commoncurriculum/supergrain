import { useEffect, useRef } from "react";

// Minimal local declaration so this file doesn't require @types/node in
// downstream packages. Consumer bundlers (and Vite library mode) replace
// `process.env.NODE_ENV` based on their build, which is what we want.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Run `cleanup` when the component truly unmounts.
 *
 * In production this is a plain useEffect cleanup — no extra hooks,
 * no extra refs, no `setTimeout`, no `clearTimeout`. After the
 * consumer's bundler replaces `process.env.NODE_ENV` and DCEs the
 * dev branch, the runtime cost is identical to a single
 * `useEffect(() => () => cleanup(), [])`. In development the dev
 * branch defers cleanup via `setTimeout(0)` so it survives React 18
 * StrictMode's mount→cleanup→remount cycle: the remount fires the
 * effect again, which clears the pending timer; on a real unmount
 * the timer survives and runs the cleanup.
 *
 * **Why the early return + ESLint suppressions:** branching the hook
 * list on `process.env.NODE_ENV` is intentional — that constant is
 * folded at the consumer's build time, so within a single build the
 * branch taken is fixed and Rules of Hooks holds. Moving the branch
 * inside the effect cleanup (or guarding with `typeof process` /
 * try-catch) would force the dev-only `timerRef` to be allocated in
 * production too — terser keeps `useRef(null)` because it's a hook
 * call with potential side effects, defeating the dev/prod split.
 *
 * This pattern matches React's own dev/prod conventions (`if
 * (process.env.NODE_ENV !== "production") ...`). Bundlers all
 * replace the literal: Vite, webpack, esbuild, Rollup with terser,
 * Parcel, Next.js, Bun. Node has `process` as a real global.
 * Unbundled browser ESM is not a supported scenario for this hook
 * (or for React itself).
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
    // eslint-disable-next-line react-hooks/rules-of-hooks -- branch is constant per build; bundler DCEs the dev path. See JSDoc.
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
