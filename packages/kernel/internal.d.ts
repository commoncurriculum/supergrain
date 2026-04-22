// Type declarations for @supergrain/kernel/internal subpath export.
// Consumed by sibling Supergrain packages (e.g. @supergrain/mill).
export { $NODE, $OWN_KEYS, $PROXY, $RAW, $VERSION } from "./src/core";
export { setProperty, deleteProperty, bumpOwnKeysSignal, bumpVersion } from "./src/write";
export { profileSignalWrite } from "./src/profiler";
export { startBatch, endBatch, getCurrentSub, setCurrentSub } from "alien-signals";
