// Export the optimized implementation
export {
  createStore,
  unwrap,
  createAccessor,
  type Signal,
  type SetStoreFunction,
} from './store'

// Export MongoDB-style update operators
export {
  update,
  resolvePath,
  setPath,
  deletePath,
  isEqual,
  type UpdateOperations,
  type ArrayModifiers,
} from './operators'

// Re-export signals primitives from alien-signals for convenience
export {
  signal,
  computed,
  effect,
  startBatch,
  endBatch,
  getCurrentSub as getListener,
} from 'alien-signals'
