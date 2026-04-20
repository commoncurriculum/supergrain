// Export the optimized implementation
export { createReactive, unwrap, $BRAND, type Signal, type Branded } from "./store";
export { getNodesIfExist, $TRACK } from "./core";

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
  type Profile,
} from "./profiler";
