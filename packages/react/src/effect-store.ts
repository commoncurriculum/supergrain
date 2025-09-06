import { effect, type EffectSubscriber } from 'alien-signals'

/**
 * EffectStore manages reactive dependencies for a React component.
 * It tracks which signals are accessed during render and subscribes to their changes.
 *
 * Uses 32-bit integer version tracking for optimal performance:
 * - V8 optimizes 32-bit integers (SMI - Small Integer) differently than regular numbers
 * - Better memory usage and CPU cache efficiency
 * - Faster comparison operations
 */
export class EffectStore {
  // Version number that increments on any tracked change (32-bit int)
  private version = 0

  // Callbacks to notify React when store changes
  private listeners = new Set<() => void>()

  // The function that will be tracked for dependencies
  private trackedFn: (() => void) | undefined

  // Cleanup function from the current effect
  private cleanupFn: (() => void) | undefined

  // Track if this is the initial run of the effect
  private isInitialRun = true

  /**
   * Set the function to track for dependencies.
   * This function should access the store properties that need to be tracked.
   */
  setTrackedFunction(fn: () => void): void {
    this.trackedFn = fn

    // Clean up any previous effect
    if (this.cleanupFn) {
      this.cleanupFn()
      this.cleanupFn = undefined
    }

    // Reset the initial run flag when setting a new tracked function
    this.isInitialRun = true

    // Create a new effect that will track dependencies
    // The effect will run once immediately to establish dependencies
    // and then again whenever any tracked dependency changes
    this.cleanupFn = effect(() => {
      // Run the tracked function to access store properties
      // This establishes the dependency tracking
      if (this.trackedFn) {
        this.trackedFn()
      }

      // Only increment version and notify on subsequent runs, not the initial run
      if (!this.isInitialRun) {
        this.incrementVersion()
        this.notifyListeners()
      } else {
        // Mark that we've completed the initial run
        this.isInitialRun = false
      }
    })
  }

  /**
   * Subscribe to changes in tracked dependencies.
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Get the current version snapshot for useSyncExternalStore.
   * Returns a 32-bit integer for optimal performance.
   */
  getSnapshot(): number {
    return this.version
  }

  /**
   * Get server snapshot (same as client for now).
   * This is required by useSyncExternalStore for SSR.
   */
  getServerSnapshot(): number {
    return this.version
  }

  /**
   * Dispose of this effect store and clean up resources.
   */
  dispose(): void {
    if (this.cleanupFn) {
      this.cleanupFn()
      this.cleanupFn = undefined
    }
    this.trackedFn = undefined
    this.listeners.clear()
    this.isInitialRun = true
  }

  /**
   * Increment the version number, maintaining 32-bit integer optimization.
   * The `| 0` operation ensures the value stays as a 32-bit signed integer.
   */
  private incrementVersion(): void {
    this.version = (this.version + 1) | 0
  }

  /**
   * Notify all listeners that the store has changed.
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener())
  }
}
