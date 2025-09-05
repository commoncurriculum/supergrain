import { effect as originalEffect } from 'alien-signals'

/**
 * The current depth of nested effects.
 * An effect is a reactive scope. If we are in an effect, the depth will be > 0.
 * @private
 */
let effectDepth = 0

/**
 * A wrapped version of the `effect` function from `alien-signals`.
 * This wrapper allows us to track whether the code is currently executing
 * inside a reactive context.
 *
 * To enable performance optimizations, all calls to `effect` in the test suite
 * and application should be imported from this file, not directly from `alien-signals`.
 *
 * @param fn The function to run within the reactive effect.
 */
export function effect(fn: () => void): void {
  const wrappedFn = () => {
    effectDepth++
    try {
      fn()
    } finally {
      effectDepth--
    }
  }
  // Call the original effect function with our wrapped function.
  originalEffect(wrappedFn)
}

/**
 * Checks if the code is currently running inside a reactive `effect` scope.
 * This is the key to the "fast path" optimization, allowing the store to skip
 * tracking dependencies when not in a reactive context.
 *
 * @returns `true` if currently inside an effect, otherwise `false`.
 */
export function isTracking(): boolean {
  return effectDepth > 0
}
