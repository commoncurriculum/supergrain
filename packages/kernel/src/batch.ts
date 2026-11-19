import { startBatch, endBatch } from "alien-signals";

/**
 * Run a synchronous callback with all signal writes coalesced. Effects fire
 * once, after the callback returns, with the final state. Safe if it throws.
 *
 * The callback **must be synchronous**; returning a Promise throws.
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
