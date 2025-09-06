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

  // The alien-signals effect that tracks dependencies
  private trackingEffect: EffectSubscriber | undefined

  // Callbacks to notify React when store changes
  private listeners = new Set<() => void>()

  // Flag to track if we're currently in a tracking phase
  private isTrackingActive = false

  // Cleanup function from the current effect
  private cleanupFn: (() => void) | undefined

  /**
   * Start tracking dependencies for the current render.
   * This should be called before accessing any store properties.
   */
  startTracking(): void {
    if (this.isTrackingActive) {
      console.warn('EffectStore: startTracking called while already tracking')
      return
    }

    this.isTrackingActive = true

    // Clean up any previous effect
    if (this.cleanupFn) {
      this.cleanupFn()
      this.cleanupFn = undefined
    }

    // Create a new effect that will track dependencies
    this.cleanupFn = effect(() => {
      // This function runs when any tracked dependency changes
      this.incrementVersion()
      this.notifyListeners()
    })

    // The effect is now active and will track any signal access
    this.trackingEffect = this.cleanupFn as unknown as EffectSubscriber
  }

  /**
   * End tracking and finalize the dependency list.
   * This should be called after the component has accessed all store properties.
   */
  endTracking(): void {
    if (!this.isTrackingActive) {
      console.warn('EffectStore: endTracking called while not tracking')
      return
    }

    this.isTrackingActive = false
    // The effect continues to run and will notify on changes
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
    this.trackingEffect = undefined
    this.listeners.clear()
    this.isTrackingActive = false
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

  /**
   * Check if this effect store is currently tracking dependencies.
   */
  get isTracking(): boolean {
    return this.isTrackingActive
  }
}
