---
"@supergrain/core": minor
"@supergrain/react": minor
---

Fine-grained array swap and optimized list rendering

### `@supergrain/core`

- **Skip version bump on array element replacement** — when setting an existing array index without changing the array length, the version signal no longer fires. Per-index signals already notify element-specific subscribers, so the version bump was redundantly triggering parent component re-renders on operations like swap.

### `@supergrain/react`

- **Rewrite `<For>` with internal `ForItem` slots** — `For` now subscribes only to structural changes (ownKeys: add, remove, splice). Each element is rendered through an internal `ForItem` tracked component that subscribes to its own per-index signal. On a swap, only the 2 affected `ForItem`s re-render instead of the entire list.

### Performance

Swap rows benchmark improved from 177.7ms to 48.0ms (3.7x faster). Script time dropped from 31ms to 2.3ms (13x faster).
