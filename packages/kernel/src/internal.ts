export {
  $ELEMENTS,
  $NODE,
  $OWN_KEYS,
  $PROXY,
  $RAW,
  $VERSION,
  trackArrayElements,
  untracked,
  type ReactiveTagged,
} from "./core";
export { setProperty, deleteProperty, bumpOwnKeysSignal, bumpVersion } from "./write";
export { profileSignalWrite } from "./profiler";

// startBatch/endBatch mutate alien-signals' global batch counter and leak on
// exception; setActiveSub must always be restored.
export { startBatch, endBatch, getActiveSub, setActiveSub } from "alien-signals";

export { makeDisposable } from "./disposable";

export { endReads, noteRead, RenderReads, startReads } from "./render-reads";
