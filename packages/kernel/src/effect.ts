import { effect as alienEffect } from "alien-signals";

import { type Disposer, makeDisposable } from "./disposable";

/**
 * Runs `fn` immediately and re-runs it whenever a signal it read changes.
 * `fn` may return a cleanup, which runs before each re-run and on stop.
 *
 * Returns a stop function that is also `Disposable`:
 *
 * @example
 * ```ts
 * const stop = effect(() => console.log(store.count));
 * stop();
 *
 * {
 *   using _ = effect(() => console.log(store.count));
 *   // ...
 * } // stopped here
 * ```
 */
export function effect(fn: () => void | (() => void)): Disposer {
  const stop = alienEffect(fn);
  return makeDisposable(stop, stop);
}
