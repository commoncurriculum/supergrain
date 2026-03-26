# FAILED: Remove Profiler Wrapper

**Date:** March 2026

## What was tried

Removed the React `<Profiler>` wrapper from the App component in `packages/js-krauset/src/main.tsx`.

## Hypothesis

React's `<Profiler>` traverses committed fibers to collect timing. With 10k+ fibers this could be measurable.

## Code

```tsx
// Before:
return (
  <Profiler id="app" onRender={onRenderProfiler}>
    <div className="container">...</div>
  </Profiler>
);

// After:
return <div className="container">...</div>;
```

## Results

Initially appeared to show +3.5% regression, but this was compared against a stale baseline (machine had drifted ~4%). Re-tested against a fresh baseline:

```
branch2 (15 runs) vs no-profiler2 (15 runs)

Benchmark                        branch2  no-profiler2      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  47.1ms        47.2ms     +0.3%    0.64     +0.3%
replace all rows                  52.6ms        52.8ms     +0.3%    0.56     +0.3%
partial update (10th)             47.0ms        47.6ms     +1.4%    0.56     +1.4%
select row                        10.6ms        10.9ms     +2.4%    0.19     +2.4%
swap rows                         46.6ms        47.1ms     +1.1%    0.13     +1.1%
remove row                        40.7ms        41.7ms     +2.3%    0.53     +2.3%
create many rows (10k)           581.3ms       582.8ms     +0.2%    0.56     +0.2%
append rows (1k to 1k)            53.8ms        53.3ms     -0.9%    0.55     -0.9%
clear rows                        44.7ms        44.5ms     -0.4%    0.42     -0.4%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (unweighted)               924.5ms       927.9ms     +0.4%
TOTAL (weighted)                   489.5         491.1     +0.3%
```

## Why it failed

+0.3% weighted — noise. The Profiler callback fires after commit, not during reconciliation. Its fiber traversal takes microseconds compared to the milliseconds in reconciliation and DOM updates. Not a bottleneck.
