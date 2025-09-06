// Main entry point for @storable/react

// Export the working hooks with proxy-based isolation
export { useStore, useTrackedStore } from './use-store-simple'

// Export other implementations for reference/testing
export {
  useSignals,
  useStore as useStoreSignals,
  useReactiveStore,
  observer,
} from './use-signals'

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
