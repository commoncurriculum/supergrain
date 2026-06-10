import { Effect } from "effect";

import { AdapterError } from "../../src";

/**
 * Wrap a Promise-returning function as an adapter `find` that returns an
 * `Effect`, failing with `AdapterError` (mirrors the example-app adapters).
 * Shared by every silo test file that builds inline adapters.
 */
export function effectFind<A extends ReadonlyArray<unknown>>(
  type: string,
  fn: (...args: A) => Promise<unknown>,
): (...args: A) => Effect.Effect<unknown, AdapterError> {
  return (...args: A) =>
    Effect.tryPromise({
      try: () => fn(...args),
      catch: (cause) => new AdapterError({ type, keys: [], cause }),
    });
}
