// Export the optimized implementation
export {
  createStore,
  createView,
  unwrap,
  setProperty,
  $VERSION,
  $NODE,
  $PROXY,
  $RAW,
  $OWN_KEYS,
  $BRAND,
  type Signal,
  type SetStoreFunction,
  type Branded,
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
