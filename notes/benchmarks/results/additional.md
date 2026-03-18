# Additional Benchmarks

> **Status:** Reference data for @supergrain/core performance characteristics.
>
> Covers proxy overhead, effect lifecycle, array operations, and complex scenarios. Benchmarked with Vitest bench on Node.js.

## Proxy Overhead (Plain Object vs Proxy)

| Benchmark                         | ops/sec | Mean (ms) | Proxy Overhead |
| --------------------------------- | ------: | --------: | -------------- |
| **Property Read** (100k) -- plain |  30,538 |     0.033 | --             |
| **Property Read** (100k) -- proxy |     510 |     1.960 | ~60x slower    |
| **Property Set** (100k) -- plain  |  30,949 |     0.032 | --             |
| **Property Set** (100k) -- proxy  |      56 |    17.908 | ~554x slower   |
| **Deep Read** (100k) -- plain     |  30,407 |     0.033 | --             |
| **Deep Read** (100k) -- proxy     |      83 |    12.088 | ~368x slower   |

Per-operation cost (~20ns per read) is negligible in typical application workloads.

## Effect Lifecycle

| Benchmark                                         | ops/sec | Mean (ms) |
| ------------------------------------------------- | ------: | --------: |
| Create/dispose 1,000 effects for one signal       |  14,285 |     0.070 |
| Create/dispose one effect 10,000 times            |   1,361 |     0.735 |
| Subscribe/unsubscribe 10k listeners to one signal |   1,289 |     0.776 |

## Batched vs Unbatched Updates

| Benchmark                                    | ops/sec | Mean (ms) | Relative        |
| -------------------------------------------- | ------: | --------: | --------------- |
| 10 batched updates (single `$set`)           | 228,195 |     0.004 | **2.2x faster** |
| 10 unbatched updates (separate `$set` calls) | 103,884 |     0.010 | baseline        |

## Array Operations (Non-Reactive)

| Benchmark                      | ops/sec | Mean (ms) |
| ------------------------------ | ------: | --------: |
| `$push`: 1,000 items           |   4,564 |     0.219 |
| `splice` remove 500 from 1,000 |   8,181 |     0.122 |
| `splice` add 500 to 1,000      |   7,076 |     0.141 |
| `sort`: 1,000 items            |   3,378 |     0.296 |
| `pop`: 1,000 items             |      22 |     45.85 |
| `shift`: 1,000 items           |      22 |     45.20 |
| `unshift`: 1,000 items         |      24 |     42.19 |

`pop`, `shift`, and `unshift` are slow because each iteration copies the full array and calls `$set`. Use `splice` or batch operations for bulk mutations.

## Array Iteration Methods (Reactive)

| Benchmark                                | ops/sec | Mean (ms) |
| ---------------------------------------- | ------: | --------: |
| `map` (1,000 items, 10x)                 |     787 |     1.270 |
| `filter` (1,000 items, 10x)              |     729 |     1.372 |
| `reduce` (1,000 items, 10x)              |     807 |     1.239 |
| `find`/`findIndex` (1,000 items, 100x)   |   1,216 |     0.823 |
| `some`/`every` (1,000 items, 100x)       |      88 |     11.43 |
| `includes`/`indexOf` (1,000 items, 100x) |     651 |     1.536 |

## Complex Scenarios

| Benchmark                                                            | ops/sec | Mean (ms) |
| -------------------------------------------------------------------- | ------: | --------: |
| Data Grid Simulation (100 rows: sort, filter, bulk update, toggle)   |     846 |     1.182 |
| Shopping Cart Simulation (50 items: quantities, discounts, removals) |   1,873 |     0.534 |
| Tree Structure (5 levels deep: toggle node, collapse leaves)         |     651 |     1.536 |

## Mixed Read/Write

| Benchmark                                 | ops/sec | Mean (ms) |
| ----------------------------------------- | ------: | --------: |
| 100 reads + 100 writes on single property |  21,091 |     0.047 |

## Complex Object Structures

| Benchmark                                             | ops/sec | Mean (ms) |
| ----------------------------------------------------- | ------: | --------: |
| Nested object and array updates (deep set, push, inc) |  97,259 |     0.010 |

## Circular Dependencies

| Benchmark                                                  | ops/sec | Mean (ms) |
| ---------------------------------------------------------- | ------: | --------: |
| Create and update circular list (10 nodes, 100 traversals) |  26,071 |     0.038 |
