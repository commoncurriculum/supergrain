import { effect, getCurrentSub, setCurrentSub, type EffectSubscriber } from '@storable/core'

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
      console.log('[EffectStore.subscribe] Setting React notify callback')
      onChangeNotifyReact = onStoreChange

      return () => {
        // Rotate version on unsubscribe to ensure re-render when subscribing again
        // This handles React StrictMode where components may keep stale snapshots
        version = (version + 1) | 0
        console.log('[EffectStore.unsubscribe] Clearing React notify, new version:', version)
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
      console.log('[EffectStore._start] Called')
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
      console.log('[EffectStore.finish] Called')
      console.log('[EffectStore.finish] Effect deps before cleanup:', (effectInstance as any)?.deps)
      console.log('[EffectStore.finish] Effect still exists?', !!effectInstance)
      console.log('[EffectStore.finish] Effect flags:', (effectInstance as any)?.flags)
      const end = endEffect
      endEffect = undefined
      end?.()
      console.log('[EffectStore.finish] Effect deps after cleanup:', (effectInstance as any)?.deps)
      console.log('[EffectStore.finish] Effect still exists after cleanup?', !!effectInstance)
      console.log('[EffectStore.finish] Effect flags after cleanup:', (effectInstance as any)?.flags)
      console.log('[EffectStore.finish] Current subscriber after cleanup:', getCurrentSub())
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
    // Save the current subscriber before we create our effect
    const prevSub = getCurrentSub()

    // Create the effect that will track dependencies
    isFirstRun = true

    // We need to create an effect that will be notified when dependencies change
    // But we don't want to track dependencies during effect creation
    // So we temporarily clear the current subscriber
    setCurrentSub(undefined)

    cleanupFn = effect(() => {
      // This function runs whenever tracked dependencies change
      // On first run, it establishes dependencies
      // On subsequent runs, it means a tracked value changed
      console.log('[Effect callback] Running, isFirstRun:', isFirstRun)
      console.log('[Effect callback] Current subscriber:', getCurrentSub())

      if (!isFirstRun) {
        // Increment version using bitwise OR for 32-bit integer optimization
        version = (version + 1) | 0
        console.log('[Effect callback] Dependency changed! New version:', version)
        // Notify React that the store changed
        if (onChangeNotifyReact) {
          console.log('[Effect callback] Notifying React of change')
          onChangeNotifyReact()
        } else {
          console.log('[Effect callback] WARNING: No React callback to notify!')
        }
      } else {
        isFirstRun = false
        console.log('[Effect callback] First run complete')
      }
    })

    // Store the effect instance
    effectInstance = cleanupFn as unknown as EffectSubscriber
    store._effect = effectInstance

    console.log('[startComponentEffect] Effect created, node:', effectInstance)
    console.log('[startComponentEffect] Effect deps initially:', (effectInstance as any).deps)

    // Now set our effect as the current subscriber
    // This is the key: component render will happen with our effect as the current subscriber
    // Any store access during render will be tracked by our effect
    setCurrentSub(effectInstance)
    console.log('[startComponentEffect] Set current subscriber to effect')
    console.log('[startComponentEffect] Verifying getCurrentSub():', getCurrentSub())

    // Set as current store
    currentStore = nextStore

    // Return function to restore previous subscriber and store
    return () => {
      console.log('[startComponentEffect.cleanup] Called')
      console.log('[startComponentEffect.cleanup] Effect deps before restore:', (effectInstance as any).deps)
      console.log('[startComponentEffect.cleanup] Current subscriber before restore:', getCurrentSub())
      setCurrentSub(prevSub)
      currentStore = prevStore
      console.log('[startComponentEffect.cleanup] Effect deps after restore:', (effectInstance as any).deps)
      console.log('[startComponentEffect.cleanup] Current subscriber after restore:', getCurrentSub())
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
