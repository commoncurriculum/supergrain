import { startBatch, endBatch } from "alien-signals";

/**
 * Run a synchronous callback with all signal writes coalesced into a single
 * notification. Effects fire once, after the callback returns, with the
 * final state.
 *
 * Wraps `startBatch`/`endBatch` in try/finally so the batch depth always
 * unwinds — even if the callback throws. Without this guard, an exception
 * inside the batch would leave alien-signals' global `batchDepth` permanently
 * elevated and silently defer every future write.
 *
 * The callback **must be synchronous**. Awaits inside a batch leak unrelated
 * writes (anything that happens during the await) into the batch and risk
 * permanently elevating `batchDepth` if the rest of the body never runs.
 *
 * @example
 * ```ts
 * batch(() => {
 *   const tmp = store.data[0];
 *   store.data[0] = store.data[2];
 *   store.data[2] = tmp;
 * }); // effects fire once with final state
 * ```
 */
export function batch<T>(fn: () => T): T {
  startBatch();
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new TypeError(
        "batch() callback must be synchronous. Awaits inside a batch leak unrelated writes into the batch and risk permanently elevating batchDepth.",
      );
    }
    return result;
  } finally {
    endBatch();
  }
}
