// Internal entrypoint consumed by sibling Supergrain packages.
// Not re-exported from the package root.
export {
  $ELEMENTS,
  $NODE,
  $OWN_KEYS,
  $PROXY,
  $RAW,
  $VERSION,
  trackArrayElements,
  type ReactiveTagged,
} from "./core";
export { setProperty, deleteProperty, bumpOwnKeysSignal, bumpVersion } from "./write";
export { profileSignalWrite } from "./profiler";

// Sharp signal primitives. Exposed here (not from the package root) because
// they have footguns: startBatch/endBatch mutate a global counter that leaks
// on exception, and setActiveSub mutates the global active-subscriber slot
// that other code assumes is restored. Public users should reach for `batch()`
// from `@supergrain/kernel` instead.
export { startBatch, endBatch, getActiveSub, setActiveSub } from "alien-signals";

// The raw alien-signals `effect`: its stop function is a bare `() => void`,
// without the `Symbol.dispose` property the public `effect` attaches. For
// sibling-package callers that create an effect per component or resource and
// never hand the stop function to user code (`tracked`, `<For>`,
// `useSignalEffect`, husk) — keeps the per-effect `defineProperty` off those
// paths.
export { effect as alienEffect } from "alien-signals";

// Attaches a `[Symbol.dispose]` to an object so it works with `using`. Used by
// husk to make resources `Disposable`.
export { makeDisposable } from "./disposable";
