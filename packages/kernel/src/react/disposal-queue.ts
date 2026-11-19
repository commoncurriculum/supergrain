// A queued effect can still fire until the flush: callers that need it to stop
// at once must guard the effect body themselves. `tracked()` needn't, since
// React ignores forceUpdate on an unmounted component.

const BACKSTOP_MS = 100;

export interface Disposer {
  dispose(): void;
}

const queue: Array<Disposer | undefined> = [];
let size = 0;
let scheduled = false;

function flush(): void {
  // Each round arms two timers; the second finds the queue drained.
  if (size === 0) {
    return;
  }
  let firstError: Error | undefined = undefined;
  // A disposer queued while draining runs in this same pass.
  for (let i = 0; i < size; i++) {
    const disposer = queue[i]!;
    queue[i] = undefined;
    try {
      disposer.dispose();
    } catch (error) {
      // Keep draining, or the remaining effects leak their subscriptions.
      firstError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  size = 0;
  scheduled = false;
  if (firstError) {
    throw firstError;
  }
}

function scheduleFlush(): void {
  // rAF fires just before paint, so the nested setTimeout runs right after it.
  // Browsers suspend rAF in hidden documents: the plain setTimeout is a backstop.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => setTimeout(flush, 0));
    setTimeout(flush, BACKSTOP_MS);
  } else {
    setTimeout(flush, 0);
  }
}

export function scheduleDisposal(disposer: Disposer): void {
  queue[size++] = disposer;
  if (!scheduled) {
    scheduled = true;
    scheduleFlush();
  }
}
