// Export the optimized implementation
export {
  createStore,
  unwrap,
  $VERSION,
  $NODE,
  $PROXY,
  $RAW,
  $OWN_KEYS,
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
  setCurrentSub,
} from 'alien-signals'
