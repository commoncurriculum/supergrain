// Internal entrypoint consumed by sibling Supergrain packages.
// Not re-exported from the package root.
export { $NODE, $OWN_KEYS, $PROXY, $RAW, $VERSION } from "./core";
export { setProperty, deleteProperty, bumpOwnKeysSignal, bumpVersion } from "./write";
export { profileSignalWrite } from "./profiler";

// Sharp signal primitives. Exposed here (not from the package root) because
// they have footguns: startBatch/endBatch mutate a global counter that leaks
// on exception, and setCurrentSub mutates the global active-subscriber slot
// that other code assumes is restored. Public users should reach for `batch()`
// from `@supergrain/kernel` instead.
export { startBatch, endBatch, getCurrentSub, setCurrentSub } from "alien-signals";
