// Main entry point for @storable/react

// Export the working hooks with proxy-based isolation
export { useStore, useTrackedStore } from './use-store'

// Export optimized hooks as alternatives (experimental)
export {
  useOptimizedStore,
  useOptimizedTrackedStore
} from './use-store-optimized'

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
  getCurrentSub,
  setCurrentSub,
  type Signal,
  type SetStoreFunction,
  type UpdateOperations,
} from '@storable/core'
