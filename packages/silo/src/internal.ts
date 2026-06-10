// Internal handle machinery, exposed for first-party layered packages (the
// `@supergrain/kernel/internal` precedent). `@supergrain/queries` drives its
// transient fetch state through the same statechart the store uses, so a
// query's retry observability transitions exactly like a document handle's.
// Not part of the public API contract — shapes here may change in minor
// releases; application code should consume the package root instead.
export { applyEvent, HandleEvent, type InternalHandle, makeIdleHandle } from "./transitions";
// The raw adapter engine. Layered packages should prefer `store.runAdapter`,
// which resolves options, reports to the store's `onError` sink, and counts
// against `maxConcurrency` — this export exists for tooling/tests that need
// the engine without a store.
export { type AdapterRunOptions, runAdapter } from "./run-adapter";
