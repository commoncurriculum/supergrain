# FAILED: Array Return from For Component

**Date:** March 2026

## What was tried

Changed the For component in `packages/react/src/use-store.ts` to return the slots array directly instead of wrapping in `React.createElement(React.Fragment, null, ...slots)`.

## Hypothesis

The Fragment wrapper adds overhead: React creates a Fragment fiber, and spreading 10k elements as arguments to `createElement` is expensive. Returning a plain array (supported since React 16) should eliminate both.

## Code

```typescript
// Before:
return React.createElement(React.Fragment, null, ...slots);

// After:
return slots as unknown as React.ReactElement;
```

## Results

```
branch (15 runs) vs array-return (15 runs)

Benchmark                         branch  array-return      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  45.2ms        43.8ms     -3.2%    0.64     -3.2%
replace all rows                  50.8ms        50.3ms     -1.0%    0.56     -1.0%
partial update (10th)             41.4ms        40.2ms     -3.1%    0.56     -3.1%
select row                        11.3ms        10.5ms     -7.4%    0.19     -7.4%
swap rows                         39.9ms        38.8ms     -2.8%    0.13     -2.8%
remove row                        33.3ms        33.8ms     +1.4%    0.53     +1.4%
create many rows (10k)           577.0ms       578.3ms     +0.2%    0.56     +0.2%
append rows (1k to 1k)            51.2ms        50.9ms     -0.6%    0.55     -0.6%
clear rows                        37.1ms        37.4ms     +0.8%    0.42     +0.8%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (unweighted)               887.3ms       883.8ms     -0.4%
TOTAL (weighted)                   472.5         471.1     -0.3%
```

## Why it failed

-0.3% weighted is noise (diff 3.5ms < baseline stddev 17.7ms).

React Fragment vs array return creates identical fiber structures. A Fragment unwraps to its children — returning an array does the same thing internally. No difference in `getHostSibling` traversal, `reconcileChildrenArray`, or fiber creation. V8 optimizes the argument spreading and createElement internally copies to an array anyway.
