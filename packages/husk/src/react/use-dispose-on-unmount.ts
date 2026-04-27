import { useEffect, useRef } from "react";

import { dispose } from "../resource";

/**
 * Internal helper. Disposes `target` on real unmount but survives the
 * cleanup-then-rerun cycle React 18 StrictMode performs in dev — the
 * `useMemo`-cached resource is the same instance across that cycle, so
 * a synchronous `dispose()` in cleanup would leave the post-StrictMode
 * component holding a torn-down resource.
 *
 * Schedule disposal on a `setTimeout(0)` macrotask in cleanup, and
 * cancel the timer if the effect runs again. Microtasks aren't safe
 * here — they can drain between StrictMode cleanup and remount.
 */
export function useDisposeOnUnmount(target: object): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        dispose(target);
      }, 0);
    };
  }, [target]);
}
