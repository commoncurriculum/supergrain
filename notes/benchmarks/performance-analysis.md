# Performance Analysis: Accurate Benchmark Results

## Executive Summary

After correcting the benchmark methodology to ensure Solid.js effects run synchronously using `createComputed` instead of `createEffect`, we now have accurate performance comparisons. The actual performance gap between @supergrain/kernel and solid-js is significant but not catastrophic.

## Corrected Performance Metrics

### Real Performance Comparison

| Operation                             | @supergrain/kernel | solid-js        | Performance Gap  |
| ------------------------------------- | ------------------ | --------------- | ---------------- |
| **Reactive reads (10k in effect)**    | 2,377 ops/sec      | 63,955 ops/sec  | **27x slower**   |
| **Non-reactive reads (100k)**         | 376 ops/sec        | 24,964 ops/sec  | **66x slower**   |
| **Property updates (1k with effect)** | ~11,000 ops/sec    | ~11,700 ops/sec | **1.06x slower** |
| **Store creation (1k stores)**        | Fast               | Slower          | **82x faster**   |

## Key Findings

### 1. The Benchmark Bug

The original benchmarks were showing "0ms" or extremely fast times for Solid.js because:

- `createEffect` is **asynchronous** in Node.js/SSR environments
- The benchmarks were completing before the effects actually ran
- This made it appear that Solid.js was 12,000x faster than reality

### 2. The Fix

- Changed from `createEffect` to `createComputed` for synchronous execution
- Now both libraries run their reactive code synchronously during benchmarks
- Results are now meaningful and comparable

### 3. Actual Performance Gaps

#### Reactive Property Access: 27-55x slower

- @supergrain/kernel: ~1,200-2,400 ops/sec
- solid-js: ~64,000-67,000 ops/sec
- This is the main performance bottleneck

#### Non-Reactive Property Access: 66x slower

- @supergrain/kernel: ~376 ops/sec
- solid-js: ~25,000 ops/sec
- Proxy overhead is significant even outside reactive contexts

#### Property Updates: Nearly Equal (1.06x slower)

- @supergrain/kernel: ~11,000 ops/sec
- solid-js: ~11,700 ops/sec
- Performance is competitive for write operations

#### Store Creation: 82x faster

- @supergrain/kernel creates stores much faster
- Likely due to simpler initialization

## Performance Breakdown

### Where @supergrain/kernel Struggles

1. **Proxy Overhead (Primary Issue)**
   - Every property access goes through proxy traps
   - Plain object: 30,000 ops/sec
   - Proxied object: 500 ops/sec
   - **60x overhead from proxy layer alone**

2. **Signal Integration**
   - `getCurrentSub()` checks on every access
   - Signal creation and management overhead
   - Wrapper functions add layers of indirection

3. **Deep Nesting**
   - Each level of nesting adds proxy overhead
   - Recursive wrapping compounds the problem

### Where @supergrain/kernel Performs Well

1. **Write Operations**
   - Nearly equal performance to solid-js
   - Batching works effectively

2. **Store Creation**
   - 82x faster than solid-js
   - Simpler initialization process

3. **MongoDB Operators**
   - Well-optimized with 1.3M ops/sec for simple operations
   - Unique feature not available in solid-js

## Realistic Assessment

### Previous Claims vs Reality

| Claim                     | Reality                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| "1.5x overhead"           | Was comparing internal reactive vs non-reactive, not vs solid-js |
| "12,000x slower"          | Was due to async effects not running in benchmarks               |
| **Actual: 27-66x slower** | For read operations, but competitive for writes                  |

### Performance Targets

Given the architecture:

**Current State:**

- Reactive reads: 27-55x slower
- Non-reactive reads: 66x slower
- Updates: 1.06x slower

**Achievable with Optimization:**

- Reactive reads: 10-20x slower (with heavy optimization)
- Non-reactive reads: 20-30x slower
- Updates: Maintain parity

**Unrealistic Goals:**

- Matching solid-js read performance with current proxy-based architecture
- The proxy overhead alone accounts for 60x slowdown

## Recommendations

### Immediate Improvements

1. **Restore Performance Optimizations**

   ```typescript
   // Re-enable no equality checking
   const sig = signal(value, { equals: false });
   ```

2. **Optimize Hot Paths**
   - Cache `getCurrentSub()` result per access
   - Reduce function call overhead
   - Inline critical operations

3. **Reduce Proxy Overhead**
   - Investigate alternative proxy strategies
   - Consider compile-time optimizations
   - Explore direct property descriptors for known shapes

### Architectural Considerations

1. **Proxy-Based Approach Limitations**
   - Fundamental ~60x overhead cannot be eliminated
   - Every property access pays this cost
   - Deep nesting multiplies the overhead

2. **Alternative Approaches**
   - Consider a hybrid approach for performance-critical paths
   - Provide escape hatches for direct access
   - Explore compilation/transformation strategies

3. **Value Proposition**
   - MongoDB operators are unique and performant
   - Write performance is competitive
   - DX and features may outweigh read performance for many use cases

## Conclusion

The corrected benchmarks show that @supergrain/kernel is **27-66x slower** for read operations compared to solid-js, not the previously reported 12,000x. This is primarily due to proxy overhead, which accounts for approximately 60x slowdown by itself.

However, write performance is nearly identical (only 1.06x slower), and @supergrain/kernel offers unique features like MongoDB-style operators. The performance gap for reads is significant but not insurmountable for many applications, especially those that are not read-heavy in hot paths.

The key insight is that the proxy-based architecture has fundamental performance limitations that cannot be fully overcome without architectural changes. Users should be aware of these tradeoffs when choosing between @supergrain/kernel and solid-js.
