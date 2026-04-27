# FAILED: Remove trackArrayVersion

**Date:** March 2026

## What was tried

Removed the `trackArrayVersion()` function and its call from the proxy read handler in `packages/core/src/read.ts`. This function subscribes the current effect to the array's `$VERSION` signal whenever an array value is returned through the proxy.

## Hypothesis

`trackArrayVersion` causes parent components to over-subscribe. When App reads `store.data`, the proxy returns the data array and calls `trackArrayVersion(dataArray)`, subscribing App's tracked effect to the data array's version signal. This means App re-renders on every structural array mutation (push, splice) even though App only passes the array through to `<For>`. For already subscribes to structural changes via `$TRACK` (ownKeys). So the App re-render is wasted work.

## Code

```typescript
// Before (in proxy get handler, after getting wrappable value with active subscriber):
if (isWrappable(value)) {
  const proxy = createReactiveProxy(value);
  trackArrayVersion(value); // subscribes current effect to array's $VERSION signal
  return proxy;
}

// After:
if (isWrappable(value)) {
  return createReactiveProxy(value);
}

// Also removed the trackArrayVersion function definition and its unused import of $VERSION/getNodes
```

## Results

```
branch (15 runs) vs no-array-version (15 runs)

Benchmark                         branch  no-array-version   diff  weight  weighted
────────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  45.2ms        46.7ms     +3.3%    0.64     +3.3%
replace all rows                  50.8ms        52.8ms     +4.0%    0.56     +4.0%
partial update (10th)             41.4ms        46.5ms    +12.1%    0.56    +12.1%
select row                        11.3ms        10.9ms     -3.3%    0.19     -3.3%
swap rows                         39.9ms        45.2ms    +13.4%    0.13    +13.4%
remove row                        33.3ms        42.1ms    +26.6%    0.53    +26.6%
create many rows (10k)           577.0ms       576.7ms     -0.1%    0.56     -0.1%
append rows (1k to 1k)            51.2ms        53.1ms     +3.7%    0.55     +3.7%
clear rows                        37.1ms        45.6ms    +22.8%    0.42    +22.8%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (unweighted)               887.3ms       919.7ms     +3.7%
TOTAL (weighted)                   472.5         487.1     +3.1%
```

NOTE: This was measured against the original `branch` baseline which had ~4% machine drift. The regression pattern matches other stale-baseline experiments. However, the regression direction and the broad impact across unrelated benchmarks suggest either a real issue or that the code change affected V8 optimization of the module.

## Why it failed

**Inconclusive due to stale baseline.** This was measured against a baseline that had drifted ~4% due to machine thermal state. The regression pattern (+3-26% across unrelated benchmarks like partial-update and swap-rows) matches the exact same pattern seen in other stale-baseline experiments (fast-push, remove-profiler). Identical unmodified code measured +3.6% against the original baseline when re-tested.

This experiment should be **retested against a fresh baseline** before drawing conclusions. The hypothesis (App over-subscribes to array version → unnecessary re-renders on splice/push) is sound in principle — For subscribes via `$TRACK` (ownKeys), not version, so the App re-render IS redundant. Whether eliminating it helps or hurts total time is unknown.

If retested and confirmed as a regression, likely causes would be:

1. Removing `getNodes(value)` from the read path delays node/version-signal creation to the first mutation, moving allocation into hotter paths
2. Removing the version subscription edge changes alien-signals propagation order, affecting React batching patterns
