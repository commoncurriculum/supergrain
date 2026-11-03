// Export the optimized implementation
export { createReactive, unwrap, $BRAND, type Signal, type Branded } from "./store";
export { getNodesIfExist, $TRACK } from "./core";

// Re-export signal primitives from alien-signals for convenience.
// `startBatch`/`endBatch`/`getActiveSub`/`setActiveSub` are intentionally not
// re-exported — they mutate global counters and leak unsafely on exception. Use
// `batch()` (below) instead. Internal consumers can still reach the raw
// primitives via `@supergrain/kernel/internal`.
export { signal } from "alien-signals";
export { computed } from "./computed";
export { effect } from "./effect";
export type { Disposer, SymbolDisposable } from "./disposable";
// `stableComputed` is a kernel-grown sibling of `computed` for derived arrays:
// one persistent reactive array, reconciled in place, so the reference is
// stable across recomputes. See ./stable-computed.
export { stableComputed } from "./stable-computed";
// `computedList` is a filtered, mapped, sorted, windowed list that updates
// one row at a time; its steps can read other docs (joins) per row. See
// ./query/computed-list.
export {
  computedList,
  type Direction,
  type LookupSource,
  type Lookups,
  type Query,
  type Sorted,
} from "./query/computed-list";
export type { Group } from "./query/index-rows";
export type { Lookup } from "./query/lookup";
export { reconcile } from "./reconcile";
export { batch } from "./batch";
export {
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
  type Profile,
} from "./profiler";
