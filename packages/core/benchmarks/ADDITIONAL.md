# Additional Benchmarks

> Detailed performance characteristics of @supergrain/core across proxy overhead, effect lifecycle, array operations, and complex scenarios.

## Proxy Overhead (Plain Object vs Proxy)

| Benchmark | ops/sec | Mean (ms) | Proxy Overhead |
|---|---:|---:|---|
| **Property Read** (100k) — plain | 30,538.00 | 0.0327 | — |
| **Property Read** (100k) — proxy | 510.14 | 1.9603 | ~60x slower |
| **Property Set** (100k) — plain | 30,948.91 | 0.0323 | — |
| **Property Set** (100k) — proxy | 55.84 | 17.9078 | ~554x slower |
| **Deep Read** (100k) — plain | 30,406.87 | 0.0329 | — |
| **Deep Read** (100k) — proxy | 82.73 | 12.0875 | ~368x slower |

> These measure the raw cost of proxy interception at 100k iterations. In practice, applications perform far fewer reads/writes per frame, so the per-operation cost (~20ns per read) is negligible.

## Effect Lifecycle

| Benchmark | ops/sec | Mean (ms) |
|---|---:|---:|
| Create/dispose 1,000 effects for one signal | 14,285.26 | 0.0700 |
| Create/dispose one effect 10,000 times | 1,360.83 | 0.7348 |
| Subscribe/unsubscribe 10k listeners to one signal | 1,288.79 | 0.7759 |

## Batched vs Unbatched Updates

| Benchmark | ops/sec | Mean (ms) | Relative |
|---|---:|---:|---|
| 10 batched updates (single `$set`) | 228,194.71 | 0.0044 | **2.2x faster** |
| 10 unbatched updates (separate `$set` calls) | 103,883.58 | 0.0096 | baseline |

> Batching multiple property updates into a single `$set` call is ~2.2x faster than individual calls.

## Array Operations (Non-Reactive)

| Benchmark | ops/sec | Mean (ms) |
|---|---:|---:|
| `$push`: 1,000 items | 4,563.54 | 0.2191 |
| `splice` remove 500 from 1,000 | 8,180.60 | 0.1222 |
| `splice` add 500 to 1,000 | 7,075.53 | 0.1413 |
| `sort`: 1,000 items | 3,377.67 | 0.2961 |
| `pop`: 1,000 items | 21.81 | 45.85 |
| `shift`: 1,000 items | 22.13 | 45.20 |
| `unshift`: 1,000 items | 23.70 | 42.19 |

> `pop`, `shift`, and `unshift` are slow because each iteration copies the full array and calls `$set`. Use `splice` or batch operations for bulk mutations.

## Array Iteration Methods (Reactive)

| Benchmark | ops/sec | Mean (ms) |
|---|---:|---:|
| `map` (1,000 items, 10x) | 787.18 | 1.2704 |
| `filter` (1,000 items, 10x) | 728.95 | 1.3718 |
| `reduce` (1,000 items, 10x) | 806.98 | 1.2392 |
| `find`/`findIndex` (1,000 items, 100x) | 1,215.86 | 0.8225 |
| `some`/`every` (1,000 items, 100x) | 87.50 | 11.43 |
| `includes`/`indexOf` (1,000 items, 100x) | 650.86 | 1.5364 |

## Complex Scenarios

| Benchmark | ops/sec | Mean (ms) |
|---|---:|---:|
| Data Grid Simulation (100 rows: sort, filter, bulk update, toggle) | 845.97 | 1.1821 |
| Shopping Cart Simulation (50 items: quantities, discounts, removals) | 1,872.88 | 0.5339 |
| Tree Structure (5 levels deep: toggle node, collapse leaves) | 651.15 | 1.5358 |

## Mixed Read/Write

| Benchmark | ops/sec | Mean (ms) |
|---|---:|---:|
| 100 reads + 100 writes on single property | 21,091.25 | 0.0474 |

## Complex Object Structures

| Benchmark | ops/sec | Mean (ms) |
|---|---:|---:|
| Nested object and array updates (deep set, push, inc) | 97,258.99 | 0.0103 |

## Circular Dependencies

| Benchmark | ops/sec | Mean (ms) |
|---|---:|---:|
| Create and update circular list (10 nodes, 100 traversals) | 26,071.21 | 0.0384 |
