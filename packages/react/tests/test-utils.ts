import { startBatch, endBatch } from '@storable/core'

/**
 * Flushes pending microtasks to ensure batched updates complete.
 * This is necessary because storable schedules endBatch() calls via queueMicrotask().
 */
export async function flushMicrotasks(): Promise<void> {
  // Wait for microtasks to run
  await Promise.resolve()
  // Double flush to catch any effects that schedule more microtasks
  await Promise.resolve()
}

/**
 * Synchronously flushes any pending batched effects.
 * This forces immediate execution of effects without waiting for microtasks.
 *
 * Note: This may not work correctly if storable has scheduled endBatch
 * via microtask, so prefer flushMicrotasks() in most cases.
 */
export function flushSync(): void {
  // Start and immediately end a batch to force flush
  startBatch()
  endBatch()
}

/**
 * Runs a callback and ensures all effects are flushed afterwards.
 * This is the synchronous version - use for non-async operations.
 */
export function actWithEffects<T>(callback: () => T): T {
  const result = callback()
  flushSync()
  return result
}

/**
 * Runs an async callback and ensures all microtasks/effects are flushed.
 * This is the preferred way to test async operations with stores.
 */
export async function actWithEffectsAsync<T>(
  callback: () => T | Promise<T>
): Promise<T> {
  const result = await callback()
  await flushMicrotasks()
  return result
}

/**
 * Waits for the next tick (microtask).
 * Useful for ensuring async operations have completed.
 */
export function nextTick(): Promise<void> {
  return Promise.resolve()
}

/**
 * Wraps a store update function to automatically flush effects.
 * This is useful for making store updates synchronous in tests.
 */
export function withAutoFlush<T extends (...args: any[]) => any>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    const result = fn(...args)
    await flushMicrotasks()
    return result
  }) as T
}

/**
 * Helper to wait for a condition to be true, checking after each microtask flush.
 * Useful for waiting for reactive updates to propagate.
 */
export async function waitFor(
  condition: () => boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 1000, interval = 10 } = options
  const startTime = Date.now()

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Timeout waiting for condition after ${timeout}ms`)
    }

    await flushMicrotasks()

    if (!condition()) {
      await new Promise(resolve => setTimeout(resolve, interval))
    }
  }
}

/**
 * Debug helper to log effect flushing.
 * Useful for understanding the timing of reactive updates in tests.
 */
export async function flushWithLogging(label?: string): Promise<void> {
  const prefix = label ? `[${label}] ` : ''
  console.log(`${prefix}Flushing microtasks...`)
  await flushMicrotasks()
  console.log(`${prefix}Microtasks flushed`)
}

/**
 * Creates a test wrapper that automatically flushes after each operation.
 * Useful for wrapping multiple store operations in tests.
 */
export function createTestWrapper() {
  return {
    async run<T>(callback: () => T | Promise<T>): Promise<T> {
      return actWithEffectsAsync(callback)
    },

    async update<T>(updateFn: () => T): Promise<T> {
      const result = updateFn()
      await flushMicrotasks()
      return result
    },

    async waitFor(condition: () => boolean, timeout?: number): Promise<void> {
      await waitFor(condition, { timeout })
    },
  }
}

/**
 * Test helper to ensure a component update and effect flush.
 * Combines React's act() with effect flushing.
 */
export async function actAndFlush(
  callback: () => void | Promise<void>
): Promise<void> {
  const { act } = await import('@testing-library/react')
  await act(async () => {
    await callback()
    await flushMicrotasks()
  })
}
