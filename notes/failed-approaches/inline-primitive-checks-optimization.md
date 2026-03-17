# FAILED: Inline Primitive Checks in Hot Paths

> **Status:** FAILED — Reverted
> **Date:** March 2026
> **TL;DR:** Adding `typeof` checks to skip `wrap()`/`unwrap()` for primitives provides no improvement or causes regression. V8's JIT already inlines these small functions. Extra branches add polymorphism that hurts tight loops (up to -99% in deep updates, -16.6% in granular reactivity).

## Goal

Skip `wrap()` and `unwrap()` function calls for primitive values using inline `typeof` checks to reduce overhead in the proxy get trap and `setProperty`.

## Background

Cross-library benchmarks showed supergrain 6-25x slower than zustand in property reads/updates. Two function calls in the hot path do unnecessary work for primitives:

1. **`wrap(value)`** in proxy `get` trap — calls `isWrappable()` which checks `typeof === 'object'` and `constructor`. For primitives, always returns the value unchanged.
2. **`unwrap(oldValue) !== unwrap(value)`** in `setProperty()` — calls `unwrap()` which does `(value && value[$RAW]) || value`. For primitives, the `$RAW` symbol lookup is unnecessary.

## What Was Tried

### Change 1: Inline primitive check in proxy get trap

```typescript
// Before
return wrap(value)

// After
return typeof value === 'object' && value !== null ? wrap(value) : value
```

### Change 2: Skip unwrap for primitives in setProperty

```typescript
// Before
if (node && unwrap(oldValue) !== unwrap(value)) {

// After
const old = typeof oldValue === 'object' && oldValue ? unwrap(oldValue) : oldValue
const val = typeof value === 'object' && value ? unwrap(value) : value
if (node && old !== val) {
```

All 117 tests passed with both changes.

## Why It Failed

### Both changes together

| Benchmark | Before (ops/sec) | After (ops/sec) | Change |
|---|---:|---:|---|
| Store Creation | 1,634 | 1,637 | ~same |
| Property Read (1M) | 20.19 | 20.07 | ~same |
| Non-reactive Updates | 5,500 | 5,520 | ~same |
| Reactive Updates | 3,929 | 3,996 | +1.7% |
| Batch Update | 260,284 | 246,144 | **-5.4%** |
| Deep Updates | 13,576 | 16,787 | +23.6% |
| Array Pushes | 22,082 | 21,662 | ~same |
| Granular Reactivity | 208,021 | 173,490 | **-16.6%** |

### setProperty change alone (get trap reverted)

| Benchmark | Before (ops/sec) | After (ops/sec) | Change |
|---|---:|---:|---|
| Deep Updates | 13,576 | 122 | **-99.1%** |
| Batch Update | 260,284 | 140,611 | **-46%** |

Catastrophic regression. The `typeof` branching in `setProperty` deoptimized the entire function — likely due to the new polymorphic comparison path in V8's tight loop optimization.

## Root Cause Analysis

1. **V8 already inlines `wrap()` and `unwrap()`:** These are small, monomorphic functions called millions of times. V8's JIT compiles them into the caller. Adding a `typeof` branch before the call doesn't save work — it adds a branch the JIT must speculate on.

2. **`typeof` checks add polymorphism:** The original `unwrap(oldValue) !== unwrap(value)` is a clean monomorphic comparison. Replacing it with `typeof` checks creates polymorphic paths V8 handles less efficiently in tight loops.

3. **The +23.6% deep update improvement was noise:** When isolated, the setProperty change alone caused -99% regression. The apparent gain was masked by benchmark variance.

4. **Granular reactivity regression:** The get-trap `typeof` check adds overhead to every property read inside effects. With 10 effects each tracking a property, the extra branch per read accumulates.

## Key Learnings

- Micro-optimizations that look good on paper can hurt in practice because they fight V8's existing optimization strategies.
- The proxy overhead is architectural, not implementational — V8 is already doing its best with the current code shape.
- Always benchmark changes in isolation, not just combined.

## Related

- `weakmap-node-storage-optimization.md` — Similar pattern: theoretical 5x improvement, actual 12-46% regression
- `reactivity-breaking-optimizations.md` — Fast-path caching attempts that broke signal identity
- `notes/safe-compile-time-optimizations.md` — Compile-time approaches that could bypass these runtime constraints
