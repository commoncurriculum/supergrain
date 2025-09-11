// Export the optimized implementation
export {
  createStore,
  unwrap,
  $VERSION,
  $NODE,
  $PROXY,
  $RAW,
  type Signal,
  type SetStoreFunction,
} from './store'

// Export MongoDB-style update operators
export {
  update,
  type UpdateOperations,
} from './operators'

// Re-export signals primitives from alien-signals for convenience
export {
  signal,
  computed,
  effect,
  startBatch,
  endBatch,
  getCurrentSub,
  getCurrentSub as getListener,
  setCurrentSub,
} from 'alien-signals'
