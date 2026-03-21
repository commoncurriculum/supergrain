# @supergrain/store

## 1.0.3

### Patch Changes

- Fix missed re-renders from array mutation methods

  Wrap array mutation methods (push, pop, shift, unshift, splice, sort, reverse, fill, copyWithin) in startBatch()/endBatch() so all internal proxy set/delete operations are batched into a single notification. Previously, multi-element operations like `push(a, b, c)` or `splice()` would fire effects once per internal operation instead of once for the entire mutation.

- Updated dependencies
  - @supergrain/core@1.0.3

## 1.0.2

### Patch Changes

- 73daaff: Include README in published packages (replace symlinks with copies)
- Updated dependencies [73daaff]
  - @supergrain/core@1.0.2

## 1.0.1

### Patch Changes

- 535cb00: Add README to published packages
- Updated dependencies [535cb00]
  - @supergrain/core@1.0.1

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

### Patch Changes

- Updated dependencies [61abd45]
  - @supergrain/core@1.0.0

## 0.1.0

### Minor Changes

- f9d5e75: Initial

### Patch Changes

- Updated dependencies [f9d5e75]
  - @supergrain/core@0.1.0
