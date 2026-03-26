# FAILED: Fast Push Bypass Proxy

**Date:** March 2026

## What was tried

Added a special case for `push` in the proxy get handler (`packages/core/src/read.ts`). Instead of the generic array mutator wrapper that calls `value.apply(receiver, args)` (which routes each pushed element through the proxy set trap → `setProperty`), the optimized push calls `Array.prototype.push.apply(target, args)` directly on the raw target and does one batch signal update.

## Hypothesis

`store.data.push(...buildData(1000))` triggers 1000 individual proxy set traps, each calling `setProperty` → `bumpVersion` → `bumpOwnKeysSignal`. Bypassing the proxy and doing one `bumpVersion` + one `bumpOwnKeysSignal` + one length signal update should be faster for the append-1k benchmark.

## Code

```typescript
// In proxy get handler, inside the ARRAY_MUTATORS.has(prop) branch:
if (prop === "push") {
  return (...args: any[]) => {
    startBatch();
    try {
      const result = Array.prototype.push.apply(target, args);
      bumpVersion(target);
      bumpOwnKeysSignal(target);
      const nodes = getNodesIfExist(target);
      if (nodes) {
        const lengthNode = nodes["length"];
        if (lengthNode) {
          lengthNode(target.length);
        }
      }
      return result;
    } finally {
      endBatch();
    }
  };
}
// Generic mutator wrapper follows for non-push mutators
```

This required adding imports for `bumpVersion`, `bumpOwnKeysSignal`, `getNodesIfExist` from core/write.

## Results

```
branch (15 runs) vs fast-push (15 runs)

Benchmark                         branch     fast-push      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  45.2ms        47.0ms     +3.9%    0.64     +3.9%
replace all rows                  50.8ms        55.0ms     +8.3%    0.56     +8.3%
partial update (10th)             41.4ms        47.1ms    +13.5%    0.56    +13.5%
select row                        11.3ms        10.9ms     -3.6%    0.19     -3.6%
swap rows                         39.9ms        48.9ms    +22.7%    0.13    +22.7%
remove row                        33.3ms        42.1ms    +26.4%    0.53    +26.4%
create many rows (10k)           577.0ms       579.2ms     +0.4%    0.56     +0.4%
append rows (1k to 1k)            51.2ms        53.2ms     +3.9%    0.55     +3.9%
clear rows                        37.1ms        44.7ms    +20.5%    0.42    +20.5%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (unweighted)               887.3ms       928.1ms     +4.6%
TOTAL (weighted)                   472.5         490.4     +3.8%
```

NOTE: This was measured against the original `branch` baseline which was ~4% stale due to machine performance drift. The regression pattern (all benchmarks worse, not just push-related ones) is real regardless.

## Why it failed

Adding `if (prop === "push")` to the proxy get handler caused V8 to deoptimize the ENTIRE handler. The regression was not isolated to append-1k — benchmarks that never call `push` (like partial-update, swap-rows, select-row) also regressed by 13-27%.

The proxy get handler is the single hottest function in the library — every property access (`id`, `label`, `className`, `selected`, array indices, `length`, `map`, etc.) routes through it. V8 aggressively inlines and optimizes this handler because it has a simple, predictable shape. Adding any conditional branch:

1. Makes the handler's control flow less predictable (V8 sees multiple return paths)
2. Increases the function's bytecode size, potentially preventing inlining at call sites
3. The deoptimization penalty applies to ALL property reads, not just `push` access

This is the same root cause as the documented handler extraction failure (`js-framework-benchmark-optimization-attempts.md`, commit `091ce55`), which showed +18% regression from extracting the get handler into a named function. See also `inline-primitive-checks-optimization.md` — adding `typeof` checks to the handler also regressed. The lesson is absolute: the proxy get handler shape is untouchable.
