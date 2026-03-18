# FAILED: WeakMap Node Storage Optimization

> **STATUS: FAILED.** Replacing `Object.defineProperty` with `WeakMap` for node storage caused a 46% regression in store creation and 12-17% regressions in read/write hot paths. Theoretical 5x improvement in setup cost was negated by WeakMap lookup overhead on every property access. Reverted.

**Date:** September 2025

## Goal

Replace `Object.defineProperty(target, $NODE, ...)` with `WeakMap` for storing reactive nodes on objects. Expected 5x faster node setup (0.015ms → 0.003ms) and ~18% total property access improvement.

## What Was Tried

**Before (Object.defineProperty):**

```typescript
function getNodes(target: object): DataNodes {
  let nodes = (target as any)[$NODE];
  if (!nodes) {
    nodes = Object.create(null);
    try {
      Object.defineProperty(target, $NODE, { value: nodes, enumerable: false });
    } catch {
      /* frozen objects */
    }
  }
  return nodes;
}
```

**After (WeakMap):**

```typescript
const objectNodes = new WeakMap<object, DataNodes>();

function getNodes(target: object): DataNodes {
  let nodes = objectNodes.get(target);
  if (!nodes) {
    nodes = Object.create(null);
    objectNodes.set(target, nodes);
  }
  return nodes;
}
```

All 80 tests passed. No API changes. Cleaner code.

## Benchmark Results

| Benchmark                        | Before (hz) | After (hz) | Change   |
| -------------------------------- | ----------- | ---------- | -------- |
| **Store Creation (1000 stores)** | 1,723       | 926        | **-46%** |
| **Mixed Read/Write**             | 17,275      | 15,234     | **-12%** |
| **Batch Updates**                | 356,247     | 294,597    | **-17%** |
| Property Access                  | 373         | 376        | +1%      |
| Property Set                     | 47          | 44         | -7%      |
| Deep Property                    | 73          | 73         | 0%       |
| Shopping Cart (complex)          | 941         | 1,523      | +62%     |
| Data Grid                        | 855         | 761        | -11%     |

Shopping Cart was the sole meaningful win, but core operations regressed badly.

## Why It Failed

1. **WeakMap.get() in hot paths is slower than `obj[$NODE]`.** Direct symbol property access is a simple property lookup. `WeakMap.get()` involves hashing and map traversal. This cost compounds on every property access.

2. **V8 optimizes `Object.defineProperty` better than expected.** The theoretical 0.015ms cost was measured in isolation. In practice, V8's JIT optimizes repeated `defineProperty` patterns on similar object shapes.

3. **Setup cost vs access cost trade-off inverted.** The optimization targeted setup (rare, one-time per object) at the expense of access (frequent, every property read/write). `getNodes()` is called on every proxy trap -- the WeakMap lookup overhead dominates.

4. **Microbenchmark assumptions didn't hold.** The 5x setup improvement was real in isolation but irrelevant because access frequency dwarfs setup frequency.

## Key Learnings

1. **Optimize the hot path, not the setup path.** `getNodes()` is called on every property access. Even a small per-call regression compounds into large total regressions.
2. **Theoretical analysis is necessary but not sufficient.** Sound reasoning + passing tests + clean code still produced a performance regression.
3. **V8 symbol property access is fast.** `obj[$NODE]` is effectively a regular property lookup, heavily optimized by V8. WeakMap lookups are not.
4. **Always benchmark before merging.** This was caught in development because benchmarks were run. Without them, the regression would have shipped.

**Files affected:** `packages/core/src/store.ts`
**Status:** Reverted
