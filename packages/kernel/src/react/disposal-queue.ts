/**
 * Deferred disposal queue for reactive-effect teardown.
 *
 * Unlinking an effect from the signal graph is pure bookkeeping — it has no
 * observable effect on the DOM or on component output. Running it synchronously
 * inside React's unmount commit puts O(subscriptions) work on the critical path
 * between a state change and the next paint (worst case: clearing a 1,000-row
 * list tears down 1,000 effects before the browser can present the empty
 * table). Instead, disposers are queued and flushed in a macrotask scheduled
 * after the next frame, off the paint-critical path.
 *
 * Safety: every queued disposer runs — the flush is only *deferred*, never
 * skipped — so subscriber lists cannot leak. Callers that need the effect to
 * stop firing immediately must guard their effect body themselves (a disposed
 * flag); `tracked()` does not need this because a spurious `forceUpdate` on an
 * unmounted component is a no-op in React.
 */

let queue: Array<() => void> = [];
let scheduled = false;

function flush(): void {
  scheduled = false;
  const disposers = queue;
  queue = [];
  let firstError: unknown;
  let hasError = false;
  for (const dispose of disposers) {
    try {
      dispose();
    } catch (error) {
      // Keep draining — "every queued disposer runs" must hold even when one
      // throws, or the remaining effects would leak their subscriptions.
      if (!hasError) {
        hasError = true;
        firstError = error;
      }
    }
  }
  if (hasError) {
    // Surface the first failure after the queue is drained (as an uncaught
    // error in the scheduling macrotask) instead of swallowing it.
    throw firstError;
  }
}

/* c8 ignore start -- rAF branch is browser-only; jsdom exercises the fallback */
function scheduleFlush(): void {
  // requestAnimationFrame fires just before the frame is presented; the nested
  // setTimeout then lands in the first macrotask after it. The plain setTimeout
  // is a backstop for environments without rAF (SSR/tests) and for hidden
  // documents, where rAF callbacks are suspended indefinitely.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => setTimeout(flush, 0));
    setTimeout(flush, 100);
  } else {
    setTimeout(flush, 0);
  }
}
/* c8 ignore stop */

/** Queue an effect disposer to run after the next paint. */
export function scheduleDisposal(dispose: () => void): void {
  queue.push(dispose);
  if (!scheduled) {
    scheduled = true;
    scheduleFlush();
  }
}
