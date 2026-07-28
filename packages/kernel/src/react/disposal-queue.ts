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

// How long to wait before flushing without a frame. Only reached when rAF
// never fires (hidden document) or doesn't exist — see scheduleFlush.
const BACKSTOP_MS = 100;

let queue: Array<() => void> = [];
let scheduled = false;

function flush(): void {
  // A round arms two timers (see scheduleFlush) and the loser fires later with
  // nothing left to do. Returning *before* clearing `scheduled` is the point:
  // clearing it here would strand the timers a subsequent round had already
  // armed, and the next scheduleDisposal would arm a third set on top.
  if (queue.length === 0) {
    return;
  }
  scheduled = false;
  const disposers = queue;
  queue = [];
  let firstError: Error | undefined = undefined;
  for (const dispose of disposers) {
    try {
      dispose();
    } catch (error) {
      // Keep draining — "every queued disposer runs" must hold even when one
      // throws, or the remaining effects would leak their subscriptions.
      firstError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (firstError) {
    // Surface the first failure after the queue is drained (as an uncaught
    // error in the scheduling macrotask) instead of swallowing it.
    throw firstError;
  }
}

function scheduleFlush(): void {
  // requestAnimationFrame fires just before the frame is presented; the nested
  // setTimeout then lands in the first macrotask after it. The plain setTimeout
  // is a backstop for environments without rAF (SSR/node tests) and for hidden
  // documents, where rAF callbacks are suspended indefinitely. Both branches are
  // exercised: tests/react covers the rAF path in a real browser,
  // tests/core covers the fallback under node.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => setTimeout(flush, 0));
    setTimeout(flush, BACKSTOP_MS);
  } else {
    setTimeout(flush, 0);
  }
}

/**
 * Queue an effect disposer to run off the paint-critical path — normally in
 * the first macrotask after the next paint, but the backstop (hidden
 * documents, environments without rAF) may fire without any paint occurring.
 * The guarantee is "deferred, always runs", not "a paint happened first".
 */
export function scheduleDisposal(dispose: () => void): void {
  queue.push(dispose);
  if (!scheduled) {
    scheduled = true;
    scheduleFlush();
  }
}
