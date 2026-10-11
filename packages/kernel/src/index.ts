// Export the optimized implementation
export { createReactive, unwrap, $BRAND, type Signal, type Branded } from "./store";
export { getNodesIfExist, $TRACK } from "./core";

// Re-export signal primitives from alien-signals for convenience.
// `startBatch`/`endBatch`/`getActiveSub`/`setActiveSub` are intentionally not
// re-exported — they mutate global counters and leak unsafely on exception. Use
// `batch()` (below) instead. Internal consumers can still reach the raw
// primitives via `@supergrain/kernel/internal`.
export { signal, computed } from "alien-signals";
export { effect } from "./effect";
export type { Disposer, SymbolDisposable } from "./disposable";
// `stableComputed` is a kernel-grown sibling of `computed` for derived arrays:
// one persistent reactive array, reconciled in place, so the reference is
// stable across recomputes. See ./stable-computed.
export { stableComputed } from "./stable-computed";
export { batch } from "./batch";
export {
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
  type Profile,
} from "./profiler";
