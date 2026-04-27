import { useEffect, useRef } from "react";

import { dispose } from "../resource";

/**
 * Internal helper. Disposes `target` on real unmount but survives the
 * cleanup-then-rerun cycle React 18 StrictMode performs in dev — the
 * `useMemo`-cached resource is the same instance across that cycle, so
 * a synchronous `dispose()` in cleanup would leave the post-StrictMode
 * component holding a torn-down resource.
 *
 * The pattern: refcount mounts, schedule disposal on a `setTimeout(0)`
 * macrotask when the count hits zero, and cancel the timer if a
 * remount fires the effect again. Microtasks aren't safe here — they
 * can drain between the StrictMode cleanup and remount.
 */
export function useDisposeOnUnmount(target: object): void {
  const mountCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    mountCountRef.current++;
    return () => {
      mountCountRef.current--;
      if (mountCountRef.current === 0) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (mountCountRef.current === 0) dispose(target);
        }, 0);
      }
    };
  }, [target]);
}
