# Performance Analysis: Corrected Benchmark Methodology

> **Status**: Current. Documents the benchmark bug fix and provides the corrected numbers.
> **TL;DR**: Original benchmarks showed solid-js 12,000x faster due to async `createEffect` in Node.js. After fixing to `createComputed`, actual gap is 27-66x for reads, ~1x for writes.

## The Benchmark Bug

The original benchmarks showed solid-js as 12,000x faster because `createEffect` is **asynchronous** in Node.js/SSR -- benchmarks completed before effects ran.

**Fix**: Changed `createEffect` to `createComputed` for synchronous execution.

## Corrected Numbers

| Operation | @supergrain/core | solid-js | Gap |
|-----------|-----------------|----------|-----|
| Reactive reads (10k in effect) | 2,377 ops/sec | 63,955 ops/sec | **27x slower** |
| Non-reactive reads (100k) | 376 ops/sec | 24,964 ops/sec | **66x slower** |
| Property updates (1k with effect) | ~11,000 ops/sec | ~11,700 ops/sec | **1.06x slower** |
| Store creation (1k stores) | Fast | Slower | **82x faster** |

### Previous Claims vs Reality

| Claim | Reality |
|-------|---------|
| "1.5x overhead" | Was comparing internal reactive vs non-reactive, not vs solid-js |
| "12,000x slower" | Async effects not running in benchmarks |
| **Actual: 27-66x slower** | For reads; competitive for writes |

## Performance Breakdown

### Where It's Slow (Reads)
- **Proxy overhead**: Plain object 30,000 ops/sec vs proxied 500 ops/sec = 60x overhead
- **`getCurrentSub()` checks**: Called on every property access
- **Deep nesting**: Each level compounds proxy overhead

### Where It's Fast (Writes + Creation)
- **Updates**: ~1.06x slower than solid-js (competitive)
- **Store creation**: 82x faster than solid-js
- **MongoDB operators**: 1.3M ops/sec for `$set`

## Optimization Targets

| | Current | Achievable | Unrealistic |
|-|---------|------------|-------------|
| Reactive reads | 27-55x slower | 10-20x slower | Matching solid-js |
| Non-reactive reads | 66x slower | 20-30x slower | Matching solid-js |
| Updates | 1.06x slower | Maintain parity | -- |

Proxy overhead (~60x) is the fundamental architectural limit for reads.
