// Internal entrypoint for benchmarks/tests inside this repository.
// This module is intentionally not re-exported from the package root.
export { $NODE, $OWN_KEYS, $PROXY, $RAW, $VERSION } from "./core";
export { setProperty, deleteProperty, bumpOwnKeysSignal, bumpVersion } from "./write";
