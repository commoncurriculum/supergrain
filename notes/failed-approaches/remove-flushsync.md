# FAILED: Remove flushSync

**Date:** March 2026

## What was tried

Removed `flushSync` from the select function in `packages/js-krauset/src/main.tsx`.

## Hypothesis

React 19 auto-batches state updates within event handlers, making `flushSync` redundant. Removing it avoids a forced synchronous flush and slightly reduces bundle size.

## Code

```typescript
// Before:
export const select = (id: number) => {
  flushSync(() => {
    store.selected = id;
  });
};

// After:
export const select = (id: number) => {
  store.selected = id;
};
```

## Results

```
branch2 (15 runs) vs no-flushsync (15 runs)

Benchmark                        branch2  no-flushsync      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  47.1ms        47.7ms     +1.2%    0.64     +1.2%
replace all rows                  52.6ms        52.4ms     -0.5%    0.56     -0.5%
partial update (10th)             47.0ms        46.1ms     -1.9%    0.56     -1.9%
select row                        10.6ms        10.3ms     -3.1%    0.19     -3.1%
swap rows                         46.6ms        45.7ms     -1.9%    0.13     -1.9%
remove row                        40.7ms        40.2ms     -1.2%    0.53     -1.2%
create many rows (10k)           581.3ms       574.6ms     -1.2%    0.56     -1.2%
append rows (1k to 1k)            53.8ms        52.8ms     -1.7%    0.55     -1.7%
clear rows                        44.7ms        44.6ms     -0.1%    0.42     -0.1%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (unweighted)               924.5ms       914.4ms     -1.1%
TOTAL (weighted)                   489.5         484.4     -1.0%
```

## Why it failed

-1.0% weighted — borderline, does not clear noise threshold (10ms diff < ~17ms stddev).

Two reasons to reject despite the promising direction:

1. **Improvement isn't select-specific.** If removing flushSync helped by eliminating a forced synchronous commit, only select-row should improve. Instead, create-10k (-1.2%), append (-1.7%), and swap (-1.9%) all improved — benchmarks that don't use flushSync. This suggests the improvement is from the slightly smaller bundle (no `flushSync` import from react-dom) changing V8 module optimization, not from the semantic change.

2. **Measurement risk.** Without flushSync, the tracked() effect's `forceUpdate()` is batched by React 19 and flushed at the end of the event handler microtask. The CDP tracing should still capture this, but the timing relationship between the click event and the DOM commit changes. The benchmark's total-time measurement depends on the update completing within the same animation frame as the click.
