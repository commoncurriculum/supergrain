# Row Operations Benchmarks

> Simulates common table/list UI operations on a 1,000-row dataset using @supergrain/core.

## Results

| Benchmark | ops/sec | Mean (ms) | p75 (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| Select row (highlight in 1,000 rows) | 8,031.73 | 0.1245 | 0.0981 | 0.1931 |
| Swap rows (swap 2 rows in 1,000 rows) | 7,971.03 | 0.1255 | 0.0977 | 0.2045 |

## Notes

- **Select row**: Creates a store with 1,000 rows, sets up a reactive effect tracking the `selected` property, then selects a row in the middle of the dataset.
- **Swap rows**: Creates a store with 1,000 rows, sets up a reactive effect tracking a specific row label, then swaps rows at index 1 and 998.
- Both operations complete in under 0.2ms on average with minimal variance, demonstrating efficient reactive updates even on larger datasets.
