// Export the optimized implementation as the default
export {
  createStore,
  unwrap,
  ReactiveStore,
  type Signal,
  type SetStoreFunction
} from './store-optimized'

// Export the original implementation for compatibility during migration
export {
  ReactiveStore as ReactiveStoreLegacy
} from './store'

// Re-export effect from alien-signals for convenience
export { effect, signal, computed, startBatch, endBatch } from 'alien-signals'

// Export the legacy isTracking for backward compatibility
export { effect as effectLegacy, isTracking } from './isTracking'
