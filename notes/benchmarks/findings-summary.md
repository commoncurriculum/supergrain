# Consolidated Benchmark Findings

> **Status**: Current. Primary reference for all performance data.
> **TL;DR**: Direct mutations provided a 6x speedup (25.4x -> 4.34x slower than RxJS). Proxy overhead (~60x) is the fundamental architectural limit. Writes are competitive with solid-js; reads are 27-66x slower.

## The Performance Journey

### Problem

Supergrain was 25.4x slower than RxJS in the krausest benchmark.

### False Assumptions (Disproven)

- String parsing overhead (~0.0125ms) -- not the bottleneck
- Signal batching vs individual updates -- not the bottleneck
- MongoDB operator framework overhead -- minimal

### Real Bottleneck

- **Path traversal overhead**: Converting `"data.0.label"` to nested property access
- **Proxy chain navigation**: Each nesting level adds significant overhead
- **Signal creation**: Creating signals for each traversed property

### Solution: Direct Mutations (6x Improvement)

```typescript
// OLD: Blocked direct mutations
set() { throw new Error('Direct mutation not allowed') }

// NEW: Enable direct mutations with automatic reactivity
set(target, prop, value) { setProperty(target, prop, value); return true }
```

```javascript
// SLOW: MongoDB operators -- path traversal overhead
updateStore({ $set: { "data.X.label": "..." } });

// FAST: Direct mutations -- 6x faster
store.data[X].label = "...";
```

- **Before**: 25.4x slower than RxJS
- **After**: 4.34x slower than RxJS

## Core Performance Data

### vs solid-js (Corrected Benchmarks)

Benchmarks corrected to use `createComputed` instead of async `createEffect`. See [performance-analysis.md](./performance-analysis.md) for methodology.

| Operation          | @supergrain/kernel | solid-js        | Gap              |
| ------------------ | ------------------ | --------------- | ---------------- |
| Reactive reads     | 2,377 ops/sec      | 63,955 ops/sec  | **27x slower**   |
| Non-reactive reads | 376 ops/sec        | 24,964 ops/sec  | **66x slower**   |
| Property updates   | ~11,000 ops/sec    | ~11,700 ops/sec | **1.06x slower** |
| Store creation     | Very fast          | Slower          | **82x faster**   |

### Proxy Overhead vs Plain Objects

| Operation          | Plain Object   | Proxy         | Overhead |
| ------------------ | -------------- | ------------- | -------- |
| Property Read      | 30,349 ops/sec | 520 ops/sec   | **58x**  |
| Property Write     | 30,030 ops/sec | 501 ops/sec   | **60x**  |
| Deep Property Read | 30,397 ops/sec | 74 ops/sec    | **411x** |
| Array Push         | 28,662 ops/sec | 2,107 ops/sec | **14x**  |

### MongoDB Operators

| Operator          | ops/sec   |
| ----------------- | --------- |
| `$set` (single)   | 1,271,016 |
| `$set` (multiple) | 539,061   |
| `$inc`            | 1,307,337 |
| `$push`           | 550,285   |
| `$addToSet`       | 316,172   |
| Complex nested    | 115,103   |

## Failed Experiments

### ForEach Component (expose signals to prevent React re-renders)

- Rendering 2.4x faster (25ms saved on 1000 items)
- Zero re-render reduction -- React reconciliation is unavoidable
- **Conclusion**: React.memo is simpler and more effective. See [foreach-analysis.md](./foreach-analysis.md).

### Direct Signal Exposure

- 2-15x faster than proxy access (simple: 2x, nested: 14x, arrays: 15x)
- Developer experience significantly worse
- See [results.md](./results.md).

### Batch Updates

- Minimal impact -- alien-signals already batches efficiently

## Architectural Summary

### Strengths

- Write performance nearly matches solid-js (1.06x)
- Store creation 82x faster
- MongoDB operators well-optimized
- Direct mutations 6x faster than operator path
- Clean DX

### Fundamental Limits

- Proxy overhead ~60x (cannot be eliminated)
- Read performance 27-66x slower than solid-js
- Deep nesting multiplies overhead
- Cannot bypass React reconciliation

### Realistic Optimization Targets

- Reactive reads: 10-20x slower (with heavy optimization)
- Non-reactive reads: 20-30x slower
- Updates: maintain current parity
