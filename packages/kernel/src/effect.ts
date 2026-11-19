import { effect as alienEffect } from "alien-signals";

import { type Disposer, toDisposer } from "./disposable";

/**
 * Runs `fn` immediately and re-runs it whenever a signal it read changes.
 * `fn` may return a cleanup, which runs before each re-run and on stop.
 *
 * Any return value is treated as the cleanup: `effect(() => store.count)`
 * throws on its next run. Use `effect(() => void store.count)`.
 *
 * Returns a stop function that is also `Disposable`:
 *
 * @example
 * ```ts
 * const stop = effect(() => console.log(store.count));
 * stop();
 *
 * // Or stop it when the enclosing scope exits:
 * function logCountDuring(work: () => void) {
 *   using _stop = effect(() => console.log(store.count));
 *   work();
 * } // stopped when logCountDuring returns or throws
 * ```
 */
export function effect(fn: () => void | (() => void)): Disposer {
  return toDisposer(alienEffect(fn));
}
