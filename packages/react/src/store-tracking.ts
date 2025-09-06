import { effect, type EffectSubscriber } from '@storable/core'

/**
 * Usage modes for effect stores, following Preact's pattern
 */
export const UNMANAGED = 0
export const MANAGED_COMPONENT = 1
export const MANAGED_HOOK = 2

export type EffectStoreUsage =
  | typeof UNMANAGED
  | typeof MANAGED_COMPONENT
  | typeof MANAGED_HOOK

/**
 * The effect store manages reactive dependencies for a React component
 */
export interface EffectStore {
  readonly _usage: EffectStoreUsage
  readonly _effect: EffectSubscriber | undefined
  subscribe(onStoreChange: () => void): () => void
  getSnapshot(): number
  getServerSnapshot(): number
  _start(): void
  finish(): void
  dispose(): void
}

/**
 * Global current store being tracked during render
 */
let currentStore: EffectStore | undefined

/**
 * Promise for cleaning up trailing stores after microtask
 */
let finalCleanup: Promise<void> | undefined

/**
 * Queue microtask using Promise
 */
const queueMicroTask = Promise.prototype.then.bind(Promise.resolve())

/**
 * Clean up any trailing store after a microtask
 */
function cleanupTrailingStore() {
  finalCleanup = undefined
  if (currentStore) {
    currentStore.finish()
  }
}

/**
 * Ensure cleanup is scheduled
 */
export function ensureFinalCleanup() {
  if (!finalCleanup) {
    finalCleanup = queueMicroTask(cleanupTrailingStore)
  }
}

/**
 * Create an effect store that tracks dependencies during render
 */
export function createEffectStore(_usage: EffectStoreUsage): EffectStore {
  let effectInstance: EffectSubscriber | undefined
  let cleanupFn: (() => void) | undefined
  let endEffect: (() => void) | undefined
  let version = 0
  let onChangeNotifyReact: (() => void) | undefined
  let isFirstRun = true

  const store: EffectStore = {
    _usage,
    _effect: undefined,

    subscribe(onStoreChange) {
      onChangeNotifyReact = onStoreChange

      return () => {
        // Rotate version on unsubscribe to ensure re-render when subscribing again
        // This handles React StrictMode where components may keep stale snapshots
        version = (version + 1) | 0
        onChangeNotifyReact = undefined
      }
    },

    getSnapshot() {
      return version
    },

    getServerSnapshot() {
      return version
    },

    _start() {
      // Clean up any previous effect
      if (cleanupFn) {
        cleanupFn()
        cleanupFn = undefined
      }

      // Handle different usage scenarios based on previous and current store
      if (currentStore === undefined) {
        // No previous store, start fresh
        endEffect = startComponentEffect(undefined, this)
        return
      }

      const prevUsage = currentStore._usage
      const thisUsage = this._usage

      if (
        (prevUsage === UNMANAGED && thisUsage === UNMANAGED) ||
        (prevUsage === UNMANAGED && thisUsage === MANAGED_COMPONENT)
      ) {
        // Finish previous effect and start fresh
        currentStore.finish()
        endEffect = startComponentEffect(undefined, this)
      } else if (
        (prevUsage === MANAGED_COMPONENT && thisUsage === UNMANAGED) ||
        (prevUsage === MANAGED_HOOK && thisUsage === UNMANAGED)
      ) {
        // Do nothing, signals will be captured by current effect store
      } else {
        // Nested scenarios, capture and restore previous store
        endEffect = startComponentEffect(currentStore, this)
      }
    },

    finish() {
      const end = endEffect
      endEffect = undefined
      end?.()
    },

    dispose() {
      this.finish()
      if (cleanupFn) {
        cleanupFn()
        cleanupFn = undefined
      }
      effectInstance = undefined
    },
  }

  // Start component effect and return finish function
  function startComponentEffect(
    prevStore: EffectStore | undefined,
    nextStore: EffectStore
  ): () => void {
    // Create the effect that will track dependencies
    isFirstRun = true
    cleanupFn = effect(() => {
      // This function runs whenever tracked dependencies change
      // On first run, it establishes dependencies
      // On subsequent runs, it means a tracked value changed

      if (!isFirstRun) {
        // Increment version using bitwise OR for 32-bit integer optimization
        version = (version + 1) | 0
        // Notify React that the store changed
        if (onChangeNotifyReact) {
          onChangeNotifyReact()
        }
      } else {
        isFirstRun = false
      }
    })

    // Store the effect instance
    effectInstance = cleanupFn as unknown as EffectSubscriber
    store._effect = effectInstance

    // Set as current store
    currentStore = nextStore

    // Return function to restore previous store
    return () => {
      currentStore = prevStore
    }
  }

  return store
}

/**
 * Create an empty effect store for SSR
 */
export function createEmptyEffectStore(): EffectStore {
  const noop = () => {}

  return {
    _usage: UNMANAGED,
    _effect: undefined,
    subscribe() {
      return noop
    },
    getSnapshot() {
      return 0
    },
    getServerSnapshot() {
      return 0
    },
    _start() {},
    finish() {},
    dispose() {},
  }
}

/**
 * Get the current store being tracked
 */
export function getCurrentStore(): EffectStore | undefined {
  return currentStore
}

/**
 * Set the current store being tracked
 */
export function setCurrentStore(store: EffectStore | undefined): void {
  currentStore = store
}
