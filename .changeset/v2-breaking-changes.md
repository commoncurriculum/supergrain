---
"@supergrain/core": major
"@supergrain/react": minor
"@supergrain/store": major
---

### Breaking Changes

- **`createStore` returns the store directly** — `createStore(initial)` now returns the reactive proxy instead of a `[store, update]` tuple. Change `const [store] = createStore(...)` to `const store = createStore(...)`.
- **`update` is a standalone function** — Import `update` from `@supergrain/core` and pass the store as the first argument: `update(store, { $set: { count: 5 } })`.
- **Removed `SetStoreFunction` and `StrictSetStoreFunction` types** — These typed the bound update function which no longer exists.

### New Features

- **`provideStore(store)`** — Wraps a store with React context plumbing. Returns `{ Provider, useStore }` for injecting a store into the component tree. The proxy identity is stable so the context value never triggers re-renders.
- **`useComputed(() => expr, deps?)`** — Derived value hook that acts as a firewall. Re-evaluates when upstream signals change, but only triggers a re-render when the result changes. Enables O(2) row selection without per-row flags.
- **`useSignalEffect(() => sideEffect)`** — Signal-tracked side effect tied to component lifecycle. Re-runs when tracked signals change, cleans up on unmount. Does not cause re-renders.

### Performance

- **Standalone `update` batches automatically** — Operations are wrapped in `startBatch/endBatch` so effects fire once per call.
