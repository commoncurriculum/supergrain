// Export the optimized implementation
export {
  createStore,
  unwrap,
  $BRAND,
  type Signal,
  type SetStoreFunction,
  type StrictSetStoreFunction,
  type Branded,
} from "./store";

// Export MongoDB-style update operators
export {
  update,
  type LooseUpdateOperations,
  type StrictUpdateOperations,
  type UpdateOperations,
} from "./operators";

// Re-export signals primitives from alien-signals for convenience
export {
  signal,
  computed,
  effect,
  startBatch,
  endBatch,
  getCurrentSub,
  setCurrentSub,
} from "alien-signals";
