import { effect as alienEffect } from "alien-signals";

import { type Disposer, toDisposer } from "./disposable";

/**
 * Runs `fn` immediately and re-runs it whenever a signal it read changes.
 * `fn` may return a cleanup, which runs before each re-run and on stop.
 *
 * alien-signals treats *any* return value as that cleanup: a callback that
 * returns a non-function (e.g. `effect(() => store.count)`) throws "cleanup
 * is not a function" on its next run. Read for subscription with a statement
 * body or `void`: `effect(() => void store.count)`.
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
  return toDisposer(alienEffect(fn));
}
