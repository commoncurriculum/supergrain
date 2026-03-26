# FAILED: Hoist Reducer Function

**Date:** March 2026

## What was tried

Hoisted the `(x: number) => x + 1` reducer out of tracked() to a module-level constant in `packages/react/src/tracked.ts`.

## Hypothesis

With 10k rows, each creates an identical `(x: number) => x + 1` closure for `useReducer`. Hoisting eliminates 10k allocations on initial render.

## Code

```typescript
// Before (inline in component):
const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

// After (module-level):
const increment = (x: number) => x + 1;
// In component:
const [, forceUpdate] = useReducer(increment, 0);
```

## Results

```
branch (15 runs) vs hoist-reducer (15 runs)

Benchmark                         branch hoist-reducer      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  45.2ms        45.3ms     +0.3%    0.64     +0.3%
replace all rows                  50.8ms        51.4ms     +1.2%    0.56     +1.2%
partial update (10th)             41.4ms        39.9ms     -3.8%    0.56     -3.8%
select row                        11.3ms        11.2ms     -1.1%    0.19     -1.1%
swap rows                         39.9ms        39.8ms     -0.4%    0.13     -0.4%
remove row                        33.3ms        33.7ms     +1.1%    0.53     +1.1%
create many rows (10k)           577.0ms       584.3ms     +1.3%    0.56     +1.3%
append rows (1k to 1k)            51.2ms        51.1ms     -0.2%    0.55     -0.2%
clear rows                        37.1ms        36.4ms     -2.0%    0.42     -2.0%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (unweighted)               887.3ms       892.9ms     +0.6%
TOTAL (weighted)                   472.5         475.8     +0.7%
```

## Why it failed

+0.7% weighted — noise. React captures the reducer on the first `useReducer` call and stores it internally. It does not re-read the argument on subsequent renders. The closure has no captured variables, so V8 shares the underlying code object regardless. The allocation cost per closure is negligible.

See also: `inline-primitive-checks-optimization.md` — another case where a "remove redundant work" hypothesis was wrong because V8 already optimizes the pattern away.
