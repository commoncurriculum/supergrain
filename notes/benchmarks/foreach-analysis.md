# ForEach Benchmark Analysis

> **Status**: Historical. Failed experiment -- exposing signals via ForEach does not prevent React re-renders.
> **TL;DR**: ForEach was 2.4x faster for render time (25ms saved on 1000 items) but zero re-render reduction. React's reconciliation processes all children regardless of signal isolation. Use React.memo instead.

## Test Environment

- Chromium via Playwright, React 19.1.1, Supergrain + alien-signals

## Results

### 1000 Items -- Parent State Change (title)

|                | Time                     | Re-renders      |
| -------------- | ------------------------ | --------------- |
| Regular .map() | 44.90ms                  | 667             |
| ForEach        | 19.00ms                  | 667             |
| **Difference** | **25.90ms saved (2.4x)** | **0 reduction** |

### 1000 Items -- Single Item Update

|                | Time    | Re-renders   |
| -------------- | ------- | ------------ |
| Regular .map() | 28.60ms | 1000         |
| ForEach        | 31.00ms | 2000 (worse) |

### Small/Medium Lists

- 10 items: no meaningful difference
- 100 items: ForEach slower (9.5ms vs 2.1ms)

## Why It Failed

Signal subscription prevents unnecessary effect runs but **cannot prevent React's reconciliation**. React still:

1. Calls the render function for ForEach
2. Maps over all items
3. Creates React elements for each
4. Reconciles the entire tree

## Conclusion

- React.memo is the correct solution for list optimization
- Proxy overhead is real but acceptable (still millions of ops/sec)
- React reconciliation is the actual bottleneck, not signal tracking
- The store's value is DX (MongoDB updates, auto-tracking), not bypassing React rendering
