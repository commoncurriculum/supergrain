# Row Operations Benchmarks

> **Status:** Reference data. Simulates common table/list UI operations on a 1,000-row dataset using @supergrain/core.

## Results

| Benchmark                             | ops/sec | Mean (ms) | p75 (ms) | p99 (ms) |
| ------------------------------------- | ------: | --------: | -------: | -------: |
| Select row (highlight in 1,000 rows)  |   8,032 |     0.125 |    0.098 |    0.193 |
| Swap rows (swap 2 rows in 1,000 rows) |   7,971 |     0.126 |    0.098 |    0.205 |

## Notes

- **Select row**: Creates a 1,000-row store, sets up a reactive effect tracking the `selected` property, then selects a row in the middle.
- **Swap rows**: Creates a 1,000-row store, sets up a reactive effect tracking a specific row label, then swaps rows at index 1 and 998.
- Both operations complete in under 0.2ms on average with minimal variance.
