// Export the optimized implementation
export { createStore, unwrap, $BRAND, type Signal, type Branded } from "./store";
export { getNodesIfExist, $TRACK } from "./core";

// Export MongoDB-style update operators
export {
  update,
  type LooseUpdateOperations,
  type StrictUpdateOperations,
  type UpdateOperations,
} from "./operators";

// Re-export signals primitives from alien-signals for convenience
export {
  effect,
  signal,
  computed,
  startBatch,
  endBatch,
  getCurrentSub,
  setCurrentSub,
} from "alien-signals";
export {
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
  profileEffectFire,
  profileTimeStart,
  profileTimeEnd,
  type Profile,
  type TimingBucket,
} from "./profiler";
