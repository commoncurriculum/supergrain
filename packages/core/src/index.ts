// Export the optimized implementation
export { createStore, unwrap, $BRAND, type Signal, type Branded } from "./store";
export { getNodesIfExist } from "./core";

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
  startBatch,
  endBatch,
  getCurrentSub,
  setCurrentSub,
} from "alien-signals";

export { profiledEffect as effect } from "./profiler";
export {
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
  profileTimeStart,
  profileTimeEnd,
  type Profile,
  type TimingBucket,
} from "./profiler";
