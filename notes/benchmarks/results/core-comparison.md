# Core Comparison: @supergrain/kernel vs solid-js/store

> **Status:** Reference data. Supergrain consistently outperforms solid-js/store in matched benchmarks.
>
> Benchmarked with Vitest bench on Node.js. Results from a single run -- relative comparisons are more meaningful than absolute numbers.

## Fair Comparisons

These categories measure equivalent operations without scheduling differences:

| Category                             | Supergrain Advantage |
| ------------------------------------ | -------------------- |
| Store Creation (1,000 stores)        | **7.4x** faster      |
| Non-reactive Reads (1M)              | **2.4x** faster      |
| Reactive Effect Creation (10k reads) | **1.7x** faster      |
| Non-reactive Updates (1,000)         | **1.6x** faster      |

## Detailed Results

### Store Creation

| Library                | ops/sec | Mean (ms) | Relative         |
| ---------------------- | ------: | --------: | ---------------- |
| **@supergrain/kernel** |   1,694 |     0.591 | **7.38x faster** |
| solid-js/store         |     230 |     4.356 | baseline         |

### Property Access (Non-reactive, 1M reads)

| Library                | ops/sec | Mean (ms) | Relative         |
| ---------------------- | ------: | --------: | ---------------- |
| **@supergrain/kernel** |      20 |     49.45 | **2.41x faster** |
| solid-js/store         |       8 |    119.24 | baseline         |

### Reactive Effect Creation (10k property reads)

| Library                | ops/sec | Mean (ms) | Relative         |
| ---------------------- | ------: | --------: | ---------------- |
| **@supergrain/kernel** |   2,980 |     0.336 | **1.72x faster** |
| solid-js/store         |   1,735 |     0.576 | baseline         |

### Non-reactive Updates (1,000)

| Library                | ops/sec | Mean (ms) | Relative         |
| ---------------------- | ------: | --------: | ---------------- |
| **@supergrain/kernel** |   4,375 |     0.229 | **1.64x faster** |
| solid-js/store         |   2,661 |     0.376 | baseline         |

### Batch Updates (3 properties)

| Library                | ops/sec | Mean (ms) | Relative            |
| ---------------------- | ------: | --------: | ------------------- |
| **@supergrain/kernel** | 394,883 |     0.003 | **~39,709x faster** |
| solid-js/store         |      10 |    100.56 | baseline            |

### Granular Reactivity (update 1 of 10 properties)

| Library                | ops/sec | Mean (ms) | Relative           |
| ---------------------- | ------: | --------: | ------------------ |
| **@supergrain/kernel** |  72,788 |     0.014 | **~7,375x faster** |
| solid-js/store         |      10 |    101.33 | baseline           |

**Note on batch/granular results:** The extreme differences reflect that supergrain's `$set` batches synchronously, while the Solid.js benchmark includes `testEffect`/`createRoot` with async scheduling overhead. Both libraries correctly trigger only the relevant effect.
