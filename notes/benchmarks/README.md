# Benchmark Documentation Index

> **Status**: Current. This is the index for all benchmark docs in this directory.

## Document Map

### Summary & Findings
| Document | What It Covers | Status |
|----------|---------------|--------|
| [findings-summary.md](./findings-summary.md) | Full performance journey: discovery of direct mutation 6x speedup, all key numbers | **Primary reference** |
| [performance-analysis.md](./performance-analysis.md) | Corrected benchmark methodology (createComputed vs createEffect bug) | Reference |
| [results.md](./results.md) | Proxy vs direct signal access comparison (2-15x faster) | Reference |
| [direct-mutation-breakthrough.md](./direct-mutation-breakthrough.md) | How direct mutations achieved 6x improvement | Reference |

### Benchmark Code Archives
| Document | What It Contains |
|----------|-----------------|
| [proxy-overhead-analysis.md](./proxy-overhead-analysis.md) | Proxy vs direct object access analysis + results |
| [proxy-overhead-benchmark.md](./proxy-overhead-benchmark.md) | Benchmark code for proxy overhead measurements |
| [allocation-analysis-benchmark.md](./allocation-analysis-benchmark.md) | Allocation/overhead source identification benchmark code + results |
| [safe-optimizations-benchmark.md](./safe-optimizations-benchmark.md) | Micro-optimization benchmark code + results (led to 2.64x improvement) |
| [signal-pooling.md](./signal-pooling.md) | Signal pooling benchmark code and results |
| [reactivity-validation-tests.md](./reactivity-validation-tests.md) | Test suite ensuring optimizations preserve reactivity contracts |

### Specific Investigations
| Document | What It Covers |
|----------|---------------|
| [foreach-analysis.md](./foreach-analysis.md) | Why exposing signals doesn't prevent React re-renders |
| [isEqual-threshold-analysis.md](./isEqual-threshold-analysis.md) | Set vs Array.includes() crossover at 50 keys |

### Results Data
| Document | What It Covers |
|----------|---------------|
| [results/core-comparison.md](./results/core-comparison.md) | Core vs solid-js comparison |
| [results/state-libraries.md](./results/state-libraries.md) | Comparison across state libraries |
| [results/row-operations.md](./results/row-operations.md) | Row operation benchmarks |
| [results/additional.md](./results/additional.md) | Additional benchmark results |

### How-To / Setup
| Document | What It Covers | Status |
|----------|---------------|--------|
| [running-benchmarks.md](./running-benchmarks.md) | How to run benchmarks, structure, targets | Current |
| [krausest-setup.md](./krausest-setup.md) | Guide for krausest/js-framework-benchmark integration | Current |

## Key Numbers

| Operation | vs solid-js/RxJS | vs Plain Objects |
|-----------|-----------------|------------------|
| Property Updates | ~1.06x slower | -- |
| Store Creation | 82x faster | -- |
| Reactive Reads | 27x slower | -- |
| Non-reactive Reads | 66x slower | -- |
| Property Read | -- | 58x slower (proxy overhead) |
| Deep Property Read | -- | 411x slower |
| Array Push | -- | 14x slower |

**Key discovery**: Direct mutations (`store.data[X].label = "..."`) are 6x faster than MongoDB operators (`updateStore({ $set: { "data.X.label": "..." } })`).

## Running Benchmarks

```bash
cd packages/core
pnpm bench:core        # Quick (~30s, for development)
pnpm bench:all         # Full suite (1-2 min, before commits)
pnpm bench:additional  # Detailed analysis only
```
