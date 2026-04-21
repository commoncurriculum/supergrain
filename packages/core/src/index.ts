// Export the optimized implementation
export { createReactive, unwrap, $BRAND, type Signal, type Branded } from "./store";
export { getNodesIfExist, $TRACK } from "./core";

// Re-export signal primitives from alien-signals for convenience.
// `startBatch`/`endBatch`/`getCurrentSub`/`setCurrentSub` are intentionally
// not re-exported — they mutate global counters and leak unsafely on
// exception. Use `batch()` (below) instead. Internal consumers can still
// reach the raw primitives via `@supergrain/core/internal`.
export { effect, signal, computed } from "alien-signals";
export { batch } from "./batch";
export {
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
  type Profile,
} from "./profiler";
