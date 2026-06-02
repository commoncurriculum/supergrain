// Export the optimized implementation
export { createReactive, unwrap, $BRAND, type Signal, type Branded } from "./store";
export { getNodesIfExist, $TRACK } from "./core";

// Re-export signal primitives from the kernel's owned reactive system for
// convenience. `startBatch`/`endBatch`/`getActiveSub`/`setActiveSub` are
// intentionally not re-exported — they mutate global counters and leak unsafely
// on exception. Use `batch()` (below) instead. Internal consumers can still
// reach the raw primitives via `@supergrain/kernel/internal`.
//
// NOTE (alien-signals 3.x): `effect(fn)` now treats `fn`'s return value as a
// cleanup function — it runs before each re-run and on dispose. A callback that
// returns a non-function value (e.g. `effect(() => store.count)`) will throw
// "cleanup is not a function" on its next run. Read for subscription with a
// statement body or `void`: `effect(() => void store.count)`.
export { effect, signal, computed } from "./system";
export { batch } from "./batch";

// Reactive-observation lifecycle primitive. `onObservationChange` fires a
// callback when a reactive node loses its last observer (and, optionally, gains
// its first); `getObservationNode` returns a reactive proxy's dedicated liveness
// node to attach handlers to. Used by `@supergrain/silo` to cancel an in-flight
// fetch when no component observes a handle anymore.
export { onObservationChange, type ReactiveNode } from "./system";
export { getObservationNode } from "./core";
export {
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
  type Profile,
} from "./profiler";
