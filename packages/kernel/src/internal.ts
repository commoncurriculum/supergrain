// Internal entrypoint consumed by sibling Supergrain packages.
// Not re-exported from the package root.
export { $NODE, $OWN_KEYS, $PROXY, $RAW, $VERSION, type ReactiveTagged } from "./core";
export { setProperty, deleteProperty, bumpOwnKeysSignal, bumpVersion } from "./write";
export { profileSignalWrite } from "./profiler";

// Sharp signal primitives. Exposed here (not from the package root) because
// they have footguns: startBatch/endBatch mutate a global counter that leaks
// on exception, and setActiveSub mutates the global active-subscriber slot
// that other code assumes is restored. Public users should reach for `batch()`
// from `@supergrain/kernel` instead.
export { startBatch, endBatch, getActiveSub, setActiveSub, type ReactiveNode } from "./system";

// Observation primitives. `trackNode`/`isObserved` directly read/mutate the
// reactive graph, so they live here (not the package root) alongside the other
// sharp tools. `onObservationChange` and `getObservationNode` are also re-
// exported from the package root for convenience.
export { trackNode, isObserved, onObservationChange } from "./system";
export { getObservationNode } from "./core";
