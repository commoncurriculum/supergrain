# FAILED: New Array Allocation

**Date:** March 2026

## What was tried

Changed `Array.from({ length: raw.length })` to `new Array(raw.length)` in the For component (`packages/react/src/use-store.ts`).

## Hypothesis

`new Array(n)` avoids the temporary object and iterator protocol overhead of `Array.from`.

## Code

```typescript
// Before:
const slots: React.ReactNode[] = Array.from({ length: raw.length });
// After:
const slots: React.ReactNode[] = new Array(raw.length);
```

## Results

```
branch (15 runs) vs new-array (15 runs)

Benchmark                         branch     new-array      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  45.2ms        44.6ms     -1.3%    0.64     -1.3%
replace all rows                  50.8ms        51.0ms     +0.3%    0.56     +0.3%
partial update (10th)             41.4ms        39.7ms     -4.3%    0.56     -4.3%
select row                        11.3ms        10.9ms     -4.0%    0.19     -4.0%
swap rows                         39.9ms        38.9ms     -2.4%    0.13     -2.4%
remove row                        33.3ms        32.9ms     -1.2%    0.53     -1.2%
create many rows (10k)           577.0ms       581.3ms     +0.7%    0.56     +0.7%
append rows (1k to 1k)            51.2ms        51.6ms     +0.8%    0.55     +0.8%
clear rows                        37.1ms        36.5ms     -1.7%    0.42     -1.7%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (unweighted)               887.3ms       887.3ms     +0.0%
TOTAL (weighted)                   472.5         473.1     +0.1%
```

## Why it failed

0.0% unweighted, +0.1% weighted — completely flat. V8 optimizes both patterns identically at this scale. Both allocate a holey array. The allocation is not a bottleneck — populating the array with React elements and subsequent reconciliation dwarf it.
