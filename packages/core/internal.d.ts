// Type declarations for @supergrain/core/internal subpath export.
// Consumed by sibling Supergrain packages (e.g. @supergrain/operators).
export { $NODE, $OWN_KEYS, $PROXY, $RAW, $VERSION } from "./src/core";
export { setProperty, deleteProperty, bumpOwnKeysSignal, bumpVersion } from "./src/write";
export { profileSignalWrite } from "./src/profiler";
