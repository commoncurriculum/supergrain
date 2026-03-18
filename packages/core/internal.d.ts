// Type declarations for @supergrain/core/internal subpath export.
// These are internal symbols exposed only for benchmarks and tests.
export { $NODE, $OWN_KEYS, $PROXY, $RAW, $VERSION } from "./src/core";
export { setProperty, bumpOwnKeysSignal, bumpVersion } from "./src/write";
