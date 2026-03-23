---
"@supergrain/core": minor
"@supergrain/react": minor
---

O(1) keyed swap and fine-grained list rendering

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
