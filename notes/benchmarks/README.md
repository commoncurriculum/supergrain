# Benchmark Documentation Index

> **Status**: Current. This is the index for all benchmark docs in this directory.

## Document Map

### Summary & Findings
| Document | What It Covers | Status |
|----------|---------------|--------|
| [findings-summary.md](./findings-summary.md) | Full performance journey: discovery of direct mutation 6x speedup, all key numbers | **Primary reference** |

### Benchmark Code Archives
| Document | What It Contains |
|----------|-----------------|
| [proxy-overhead-analysis.md](./proxy-overhead-analysis.md) | Proxy vs direct object access analysis + results |
| [allocation-analysis-benchmark.md](./allocation-analysis-benchmark.md) | Allocation/overhead source identification benchmark code + results |
| [safe-optimizations-benchmark.md](./safe-optimizations-benchmark.md) | Micro-optimization benchmark code + results (led to 2.64x improvement) |
| [reactivity-validation-tests.md](./reactivity-validation-tests.md) | Test suite ensuring optimizations preserve reactivity contracts |

### Specific Investigations
| Document | What It Covers |
|----------|---------------|
| [foreach-analysis.md](./foreach-analysis.md) | Why exposing signals doesn't prevent React re-renders |
| [isEqual-threshold-analysis.md](./isEqual-threshold-analysis.md) | Set vs Array.includes() crossover at 50 keys |

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
