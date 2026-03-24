# @supergrain/core

## 2.0.0

### Major Changes

- ae766bd: ### Breaking Changes
  - **`createStore` returns the store directly** — `createStore(initial)` now returns the reactive proxy instead of a `[store, update]` tuple. Change `const [store] = createStore(...)` to `const store = createStore(...)`.
  - **`update` is a standalone function** — Import `update` from `@supergrain/core` and pass the store as the first argument: `update(store, { $set: { count: 5 } })`.
  - **Removed `SetStoreFunction` and `StrictSetStoreFunction` types** — These typed the bound update function which no longer exists.

  ### New Features
  - **`provideStore(store)`** — Wraps a store with React context plumbing. Returns `{ Provider, useStore }` for injecting a store into the component tree. The proxy identity is stable so the context value never triggers re-renders.
  - **`useComputed(() => expr, deps?)`** — Derived value hook that acts as a firewall. Re-evaluates when upstream signals change, but only triggers a re-render when the result changes. Enables O(2) row selection without per-row flags.
  - **`useSignalEffect(() => sideEffect)`** — Signal-tracked side effect tied to component lifecycle. Re-runs when tracked signals change, cleans up on unmount. Does not cause re-renders.

  ### Performance
  - **Standalone `update` batches automatically** — Operations are wrapped in `startBatch/endBatch` so effects fire once per call.

## 1.3.0

### Minor Changes

- e931b84: ### Performance
  - **O(1) row selection** — Moved `isSelected` from a computed comparison (`selected === item.id`) to a boolean property signal on each row item. Select now flips two booleans instead of re-evaluating every row, eliminating the O(n) scan.
  - **Skip signal reads without active subscriber** — When no tracking context exists (`getCurrentSub()` is null), property reads short-circuit past signal creation and return the raw value directly. Zero-cost reads outside reactive contexts.
  - **flushSync for select** — Wrapped the select handler in `flushSync` for synchronous DOM commits, matching Krause benchmark measurement.

  ### New Features
  - **Signal profiler** — New opt-in profiler for diagnosing signal behavior. Tracks reads, writes, skipped reads, and effect runs. Zero cost when disabled. New exports: `enableProfiling`, `disableProfiling`, `getProfile`, `resetProfiler`.

  ### Breaking Changes
  - **Typed/schema API removed** — Deleted `createModelView`, `SchemaLike`, `attachViewNodes`, and the `createStore(state, schema)` overload. The typed layer and all associated benchmarks/tests have been removed.

## 1.2.0

### Minor Changes

- adafe77: O(1) keyed swap and fine-grained list rendering

  ### `@supergrain/core`
  - **Skip version bump on array element replacement** — when setting an existing array index without changing length, the version signal no longer fires. Per-index signals already notify element subscribers. This prevents parent components from re-rendering on swap.

  ### `@supergrain/react`
  - **O(1) keyed swap via `parent` prop on `<For>`** — pass a ref to the container element to enable direct DOM moves on swap. An alien-signals effect detects element swaps and calls `insertBefore` to move DOM nodes directly, bypassing React's O(n) reconciliation entirely. Swap script time: **0.3ms actual** (was ~8ms). Total swap time: **~13ms actual** (was ~45ms).

  - **ForItem architecture with item caching** — each list element is rendered through an internal `ForItem` tracked component. When `parent` is provided, `ForItem` caches its item in a ref so property-change re-renders (e.g., label updates) use the correct item even after a DOM move.

  - **Fine-grained property updates** — changing `item.label` only re-renders the affected row. `<For>` does not re-render. Other rows are untouched.

  - **Batched benchmark operations** — `swapRows`, `update`, and `clear` wrapped in `startBatch`/`endBatch` for atomic multi-mutation updates.

  ### Usage

  ```tsx
  // O(1) swap — pass parent ref
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  <tbody ref={tbodyRef}>
    <For each={store.data} parent={tbodyRef}>
      {(item) => <Row key={item.id} item={item} />}
    </For>
  </tbody>

  // Standard — no ref needed, O(n) React reconciliation on swap
  <For each={store.data}>
    {(item) => <Row key={item.id} item={item} />}
  </For>
  ```

  ### Documentation
  - Added "Synchronous Writes and Batching" section to README

## 1.1.0

### Minor Changes

- 20a6f46: Fine-grained array swap and optimized list rendering

  ### `@supergrain/core`
  - **Skip version bump on array element replacement** — when setting an existing array index without changing the array length, the version signal no longer fires. Per-index signals already notify element-specific subscribers, so the version bump was redundantly triggering parent component re-renders on operations like swap.

  ### `@supergrain/react`
  - **Rewrite `<For>` with internal `ForItem` slots** — `For` now subscribes only to structural changes (ownKeys: add, remove, splice). Each element is rendered through an internal `ForItem` tracked component that subscribes to its own per-index signal. On a swap, only the 2 affected `ForItem`s re-render instead of the entire list.

  ### Performance

  Swap rows benchmark improved from 177.7ms to 48.0ms (3.7x faster). Script time dropped from 31ms to 2.3ms (13x faster).

## 1.0.4

### Patch Changes

- 4bbe1d6: Fix For component missing re-renders on in-place array mutations (sort, reverse, fill, copyWithin)

## 1.0.3

### Patch Changes

- Fix missed re-renders from array mutation methods

  Wrap array mutation methods (push, pop, shift, unshift, splice, sort, reverse, fill, copyWithin) in startBatch()/endBatch() so all internal proxy set/delete operations are batched into a single notification. Previously, multi-element operations like `push(a, b, c)` or `splice()` would fire effects once per internal operation instead of once for the entire mutation.

## 1.0.2

### Patch Changes

- 73daaff: Include README in published packages (replace symlinks with copies)

## 1.0.1

### Patch Changes

- 535cb00: Add README to published packages

## 1.0.0

### Major Changes

- 61abd45: ## 1.0.0 — First Stable Release

  Supergrain is the fastest, most ergonomic reactive store for React. Mutate plain objects directly — only components that read the changed property re-render.

  ### Highlights

  **Plain-object reactivity** — No actions, reducers, selectors, or providers. Create a store and mutate it like any JavaScript object:

  ```ts
  const [store] = createStore({ count: 0 });
  store.count = 1; // only components reading count re-render
  ```

  **Automatic render scoping** — `tracked()` subscribes a component only to the properties it reads. A parent updating `store.selected` won't re-render a child that only reads `item.label`.

  **Optimized list rendering** — The `<For>` component tracks which array items actually changed:

  ```ts
  store.todos[500].completed = true; // only row 500 re-renders, not the other 999
  ```

  **Full TypeScript inference** — Store shapes, update operators, and dot-notation paths are all inferred from usage.

  **Synchronous state** — Changes apply immediately. No batching queues, no tick delays.

  **Update operators** — Optional structured mutations for batch operations that go beyond simple property assignment:

  ```ts
  const [store, update] = createStore({ tags: ["react", "signals", "react"] });
  update({ $addToSet: { tags: "new-tag" }, $pull: { tags: "react" } });
  ```

  Nine operators (`$set`, `$unset`, `$inc`, `$push`, `$pull`, `$addToSet`, `$min`, `$max`, `$rename`) — all type-safe with dot-notation path inference. Inspired by MongoDB's update operators.

  ### Packages
  - **@supergrain/core** — `createStore`, `unwrap`, `update`, and signal primitives from [alien-signals](https://github.com/johnsoncodehk/signals) (`signal`, `computed`, `effect`, `startBatch`, `endBatch`)
  - **@supergrain/react** — `tracked()` for per-component reactivity, `<For>` for optimized lists, re-exports everything from core. Requires React 18.2+ or 19.x.
  - **@supergrain/store** — Document-oriented store for app-level state: look up records by model and ID, with built-in fetch handling and reactive loading/error states.

  ### Install

  ```
  pnpm add @supergrain/react
  ```

## 0.1.0

### Minor Changes

- f9d5e75: Initial
