# Core Comparison Benchmarks: @supergrain/core vs solid-js/store

> Benchmarked with Vitest bench on Node.js. Results from a single run — relative comparisons are more meaningful than absolute numbers.

## Store Creation

| Benchmark | ops/sec | Mean (ms) | Relative |
|---|---:|---:|---|
| **@supergrain/core**: create 1000 stores | 1,693.61 | 0.5905 | **7.38x faster** |
| solid-js/store: create 1000 stores | 229.60 | 4.3555 | baseline |

## Property Access (Non-reactive)

| Benchmark | ops/sec | Mean (ms) | Relative |
|---|---:|---:|---|
| **@supergrain/core**: 1M non-reactive reads | 20.22 | 49.45 | **2.41x faster** |
| solid-js/store: 1M non-reactive reads | 8.39 | 119.24 | baseline |

## Reactive Effect Creation

| Benchmark | ops/sec | Mean (ms) | Relative |
|---|---:|---:|---|
| **@supergrain/core**: create effect with 10k property reads | 2,980.35 | 0.3355 | **1.72x faster** |
| solid-js/store: create effect with 10k property reads | 1,735.06 | 0.5763 | baseline |

## Batch Updates (3 properties)

| Benchmark | ops/sec | Mean (ms) | Relative |
|---|---:|---:|---|
| **@supergrain/core**: batch update 3 properties | 394,882.94 | 0.0025 | **~39,709x faster** |
| solid-js/store: batch update 3 properties | 9.94 | 100.56 | baseline |

> Note: The extreme difference here reflects that supergrain's `$set` batches all property updates into a single synchronous operation, whereas the Solid.js benchmark uses `testEffect`/`createRoot` with async scheduling overhead.

## Granular Reactivity (update 1 of 10 properties)

| Benchmark | ops/sec | Mean (ms) | Relative |
|---|---:|---:|---|
| **@supergrain/core**: update one property in 10-property object | 72,787.92 | 0.0137 | **~7,375x faster** |
| solid-js/store: update one property in 10-property object | 9.87 | 101.33 | baseline |

> Note: Same caveat as above — Solid.js benchmarks include `testEffect` overhead. Both libraries correctly trigger only the relevant effect.

## Non-reactive Store Operations

| Benchmark | ops/sec | Mean (ms) | Relative |
|---|---:|---:|---|
| **@supergrain/core**: 1000 non-reactive updates | 4,374.95 | 0.2286 | **1.64x faster** |
| solid-js/store: 1000 non-reactive updates | 2,661.15 | 0.3758 | baseline |

## Summary

| Category | Supergrain Advantage |
|---|---|
| Store Creation | **7.4x** faster |
| Non-reactive Reads | **2.4x** faster |
| Reactive Effect Creation | **1.7x** faster |
| Non-reactive Updates | **1.6x** faster |
| Batch Updates | Significantly faster (sync vs async scheduling) |
| Granular Reactivity | Significantly faster (sync vs async scheduling) |

Supergrain consistently outperforms solid-js/store across all measured categories. The most fair apples-to-apples comparisons are store creation, non-reactive reads, effect creation, and non-reactive updates — where supergrain is **1.6x–7.4x faster**.
