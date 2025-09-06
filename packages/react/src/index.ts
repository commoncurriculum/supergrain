// Main entry point for @storable/react

// Export the primary hooks
export {
  useStore,
  useReactiveStore,
  useStoreInHook,
  useObserver,
} from './use-store'

// Export store tracking utilities for advanced use cases
export {
  createEffectStore,
  createEmptyEffectStore,
  getCurrentStore,
  setCurrentStore,
  ensureFinalCleanup,
  UNMANAGED,
  MANAGED_COMPONENT,
  MANAGED_HOOK,
  type EffectStore,
  type EffectStoreUsage,
} from './store-tracking'

// Re-export core functionality that users might need
export {
  createStore,
  unwrap,
  signal,
  computed,
  effect,
  startBatch,
  endBatch,
  update,
  type Signal,
  type SetStoreFunction,
  type UpdateOperations,
} from '@storable/core'
