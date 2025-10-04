# Supergrain Benchmark Documentation

This directory contains comprehensive performance analysis and benchmarking documentation for `@supergrain/core`.

## Quick Navigation

### 📊 Key Documents

- **[Consolidated Findings](./consolidated-findings.md)** - Complete performance journey and breakthrough discoveries
- **[Performance Analysis](./performance-analysis.md)** - Corrected benchmark methodology and accurate results
- **[Analysis Report](./analysis.md)** - Detailed comparison with solid-js across all operations

### 🔧 Benchmark Setup

- **[Benchmarks Guide](./benchmarks.md)** - How to run and interpret benchmarks
- **[Core Benchmarks README](./core-benchmarks-readme.md)** - Detailed benchmark structure documentation

### 🧪 Specific Investigations

- **[Proxy vs Direct Signals](./results.md)** - Performance comparison of different API approaches
- **[ForEach Analysis](./foreach-analysis.md)** - Why exposing signals doesn't prevent React re-renders
- **[JS Framework Benchmark Plan](./js-benchmark-plan.md)** - Guide for krauset benchmark integration

## Executive Summary

**The Big Discovery**: Enabling direct mutations provided **6x performance improvement**:
- **Before**: 25.4x slower than RxJS
- **After**: 4.34x slower than RxJS
- **Method**: `store.data[X].label = "..."` vs `updateStore({ $set: { "data.X.label": "..." } })`

## Performance at a Glance

### vs RxJS/solid-js
| Operation | Supergrain Performance | Gap |
|-----------|---------------------|-----|
| Property Updates | ~1.06x slower | ✅ Competitive |
| Store Creation | 82x faster | ✅ Excellent |
| Reactive Reads | 27x slower | ⚠️ Significant |
| Non-reactive Reads | 66x slower | ⚠️ Significant |

### Proxy Overhead
| Operation | Overhead vs Plain Objects |
|-----------|---------------------------|
| Property Read | 58x slower |
| Deep Property Read | 411x slower |
| Array Push | 14x slower |

## Key Insights

### ✅ What Supergrain Does Well
1. **Write Performance**: Nearly matches solid-js
2. **Developer Experience**: Clean, intuitive proxy-based API
3. **MongoDB Operators**: Unique, well-optimized feature set
4. **Direct Mutations**: 6x performance improvement available
5. **Store Creation**: Significantly faster than competitors

### ⚠️ Performance Limitations
1. **Proxy Overhead**: Fundamental ~60x slowdown for reads
2. **Deep Nesting**: Multiplicative performance cost
3. **Read-Heavy Applications**: 27-66x slower than solid-js
4. **Cannot Bypass React**: Reconciliation limits optimization potential

## When to Use Supergrain

### ✅ Great Choice For:
- CRUD applications (forms, dashboards, admin panels)
- Applications prioritizing developer experience
- MongoDB-familiar teams wanting similar update syntax
- Apps with more writes than reads
- Teams wanting automatic dependency tracking

### ⚠️ Consider Alternatives For:
- Read-heavy applications with performance requirements
- Real-time visualizations (60 FPS animations)
- Large data grids with complex nested access
- Games with frame-critical updates

## Running Benchmarks

```bash
# Quick development benchmarks (~30 seconds)
cd packages/core
pnpm bench:core

# Comprehensive analysis (1-2 minutes)
pnpm bench:all

# Krauset benchmark comparison
cd packages/js-krauset
npm run build-prod
# Then run in js-framework-benchmark
```

## Key Metrics to Track

1. **Relative Performance**: vs solid-js/RxJS
2. **Direct Mutation Impact**: New vs old approaches
3. **Memory Usage**: Avoid leaks in create/dispose cycles
4. **Consistency**: Low standard deviation in results

## Document History

This documentation captures the complete performance analysis journey, including:
- Initial incorrect assumptions about bottlenecks
- Discovery of proxy traversal overhead as real issue
- Breakthrough enabling of direct mutations (6x improvement)
- Comprehensive comparison with solid-js and RxJS
- Failed experiments (ForEach, signal exposure) and learnings
- Realistic performance expectations and use case guidance

All benchmark results have been verified with corrected methodologies to ensure accuracy.
