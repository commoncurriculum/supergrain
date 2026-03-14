# Failed Optimization: Inline Primitive Checks in Hot Paths

**Date:** March 2026
**Optimization Attempted:** Skip `wrap()` and `unwrap()` function calls for primitive values using inline `typeof` checks
**Result:** No improvement or regression, reverted
**Key Lesson:** V8's JIT already inlines small functions like `wrap()` and `unwrap()` effectively. Adding `typeof` branches to hot paths gives the JIT more speculation work without measurable benefit.

## Background

Cross-library benchmarks (supergrain vs zustand, jotai, valtio, mobx) showed supergrain 6-25x slower than zustand in property reads and updates. Analysis identified two function calls in the hot path that do unnecessary work for primitive values:

1. `wrap(value)` in the proxy `get` trap — calls `isWrappable()` which checks `typeof === 'object'` and `constructor`. For primitives (numbers, strings, booleans), this always returns the value unchanged.
2. `unwrap(oldValue) !== unwrap(value)` in `setProperty()` — calls `unwrap()` which does `(value && value[$RAW]) || value`. For primitives, the `$RAW` symbol lookup is unnecessary.

## Changes Attempted

### Change 1: Inline primitive check in proxy get trap

```typescript
// Before (lines 128-136 of store.ts)
if (!getCurrentSub()) {
  return wrap(value)
}
const nodes = getNodes(target)
const node = getNode(nodes, prop, value)
return wrap(node())

// After
if (!getCurrentSub()) {
  return typeof value === 'object' && value !== null ? wrap(value) : value
}
const nodes = getNodes(target)
const node = getNode(nodes, prop, value)
const tracked = node()
return typeof tracked === 'object' && tracked !== null ? wrap(tracked) : tracked
```

### Change 2: Skip unwrap for primitives in setProperty

```typescript
// Before (line 79 of store.ts)
if (node && unwrap(oldValue) !== unwrap(value)) {

// After
const old = typeof oldValue === 'object' && oldValue ? unwrap(oldValue) : oldValue
const val = typeof value === 'object' && value ? unwrap(value) : value
if (node && old !== val) {
```

## Results

All 117 tests passed with both changes. Benchmarks told a different story.

### Both changes applied together

| Benchmark | Before (ops/sec) | After (ops/sec) | Change |
|---|---:|---:|---|
| Store Creation | 1,634 | 1,637 | ~same |
| Property Read (1M) | 20.19 | 20.07 | ~same |
| Non-reactive Updates | 5,500 | 5,520 | ~same |
| Reactive Updates | 3,929 | 3,996 | +1.7% |
| Batch Update | 260,284 | 246,144 | **-5.4%** |
| Deep Updates | 13,576 | 16,787 | **+23.6%** |
| Array Pushes | 22,082 | 21,662 | ~same |
| Granular Reactivity | 208,021 | 173,490 | **-16.6%** |

Deep updates improved, but granular reactivity regressed significantly.

### Only setProperty change (get trap reverted)

| Benchmark | Before (ops/sec) | After (ops/sec) | Change |
|---|---:|---:|---|
| Deep Updates | 13,576 | 122 | **-99.1%** |
| Batch Update | 260,284 | 140,611 | **-46%** |

Catastrophic regression in deep updates. The `typeof` branching in `setProperty` interacted badly with V8's optimization of the hot loop — likely deoptimizing the entire function due to the new polymorphic comparison path.

## Analysis

1. **V8 already inlines `wrap()` and `unwrap()`**: These are small, monomorphic functions called millions of times. V8's JIT compiles them into the caller. Adding a `typeof` branch before the call doesn't save work — it adds a branch the JIT must speculate on.

2. **`typeof` checks add polymorphism**: The original `unwrap(oldValue) !== unwrap(value)` is a clean monomorphic comparison. Replacing it with `typeof` checks creates polymorphic paths that V8 handles less efficiently in tight loops.

3. **The improvement in deep updates (both-changes variant) was likely noise**: When isolated, the setProperty change alone caused a 99% regression. The apparent +23.6% gain was likely masked by benchmark variance or a lucky JIT compilation.

4. **Granular reactivity regression**: The get-trap `typeof` check adds overhead to every property read inside effects. With 10 effects each tracking a property, the extra branch per read accumulates.

## Conclusion

This follows the same pattern as other failed optimizations documented in this project: micro-optimizations that look good on paper but hurt in practice because they fight V8's existing optimization strategies. The proxy overhead is architectural, not implementational — V8 is already doing its best with the current code shape.

## Related

- `weakmap-node-storage-optimization.md` — Similar pattern: theoretical 5x improvement, actual 12-46% regression
- `reactivity-breaking-optimizations.md` — Fast-path caching attempts that broke signal identity
- `notes/safe-compile-time-optimizations.md` — Compile-time approaches that could bypass these runtime constraints
