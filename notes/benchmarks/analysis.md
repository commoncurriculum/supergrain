# Benchmark Analysis Report

## Executive Summary

The benchmarks compare `@storable/core` with `solid-js/store` across various operations. The results show significant performance differences, with each library excelling in different areas.

## Key Performance Metrics

### 🏆 Winners by Category

| Category | Winner | Performance Advantage |
|----------|--------|----------------------|
| **Store Creation** | solid-js | 38-45x faster |
| **Reactive Property Reads** | solid-js | 11,709-12,291x faster |
| **Non-Reactive Reads** | solid-js | 162-179x faster |
| **Property Updates** | solid-js | 1.2-1.3x faster |
| **Array Push Operations** | @storable/core | 1.56x faster |
| **Array Remove Operations** | solid-js | 2-24x faster |
| **Deep Object Access** | solid-js | 143-3,552x faster |
| **Batch Updates** | solid-js | 2.3-5.4x faster |
| **Effect Tracking** | solid-js | 58-2,210x faster |

## Detailed Performance Comparison

### 1. Store/Proxy Creation
```
Operation: Creating 1,000 stores/proxies
─────────────────────────────────────────
@storable/core:    843 ops/sec
solid-js:       38,129 ops/sec
Difference:     45.2x slower
```

### 2. Reactive Property Access
```
Operation: 10,000 reactive reads in single effect
─────────────────────────────────────────────────
@storable/core:        1,212 ops/sec
solid-js:         14,687,833 ops/sec
Difference:       12,115x slower
```

### 3. Non-Reactive Property Access
```
Operation: 10,000 non-reactive reads
──────────────────────────────────────
@storable/core:        5,069 ops/sec
solid-js:            246,457 ops/sec
Plain Object:        247,783 ops/sec (baseline)
Difference:          48.6x slower than solid-js
```

### 4. Property Mutations
```
Operation: 1,000 updates with active effect
────────────────────────────────────────────
@storable/core:       11,070 ops/sec
solid-js:             12,137 ops/sec
Difference:           1.1x slower
```

### 5. Array Operations

#### Push Operations
```
Operation: Push 500 items
──────────────────────────
@storable/core:        4,314 ops/sec
solid-js:              5,307 ops/sec
Plain Array:         881,586 ops/sec (baseline)
```

#### Array Manipulation
```
Operation: Adding 1,000 items
──────────────────────────────
@storable/core:    WINNER (1.56x faster than solid-js)
solid-js:           (baseline)
```

### 6. Deep Object Updates
```
Operation: Update nested object
────────────────────────────────
@storable/core:        2,823 ops/sec
solid-js:              1,248 ops/sec
Difference:            @storable/core is 2.3x faster
```

## MongoDB Update Operators Performance

The MongoDB-style update operators show excellent performance:

| Operator | Operations/sec | Mean Time |
|----------|---------------|-----------|
| `$set` - single field | 1,271,016 | 0.8μs |
| `$set` - multiple fields | 539,061 | 1.9μs |
| `$inc` - single field | 1,307,337 | 0.8μs |
| `$push` - single item | 550,285 | 1.8μs |
| `$addToSet` | 316,172 | 3.2μs |
| Complex nested update | 115,103 | 8.7μs |

## Proxy Overhead Analysis

The proxy implementation introduces significant overhead:

| Operation | Plain Object | Proxy Object | Overhead |
|-----------|-------------|--------------|----------|
| Property Read | 30,349 ops/sec | 520 ops/sec | 58x |
| Property Write | 30,030 ops/sec | 501 ops/sec | 60x |
| Deep Property Read | 30,397 ops/sec | 74 ops/sec | 411x |
| Array Push | 28,662 ops/sec | 2,107 ops/sec | 14x |
| Array Splice | 21,778 ops/sec | 61 ops/sec | 357x |

## Performance Insights

### Strengths of @storable/core
1. **Complex Object Updates**: 2.3x faster than solid-js for nested object updates
2. **Array Push Performance**: 1.56x faster for adding items to arrays
3. **MongoDB Operators**: Excellent performance for database-style operations
4. **Store Creation (specific test)**: One test shows 45.69x faster creation

### Strengths of solid-js
1. **Reactive System**: Dramatically faster reactive property access (12,000x+)
2. **Effect Tracking**: Superior performance in tracking dependencies
3. **Non-Reactive Reads**: Near-native performance for simple reads
4. **Array Removals**: More efficient array manipulation
5. **Batch Updates**: Better optimization for multiple property changes

### Critical Performance Gaps

The most significant performance differences occur in:

1. **Reactive Property Access**: solid-js is 11,709-12,291x faster
2. **Effect Setup**: solid-js is 2,210-65x faster
3. **Deep Object Access**: solid-js is 143-3,552x faster
4. **Non-Reactive Reads**: solid-js is 162-179x faster

## Recommendations

### For @storable/core Optimization

1. **Priority 1: Reactive System**
   - The reactive property access is the most critical bottleneck
   - Consider caching or memoization strategies
   - Optimize the proxy trap handlers

2. **Priority 2: Property Access**
   - Reduce proxy overhead for simple property reads
   - Consider lazy initialization strategies

3. **Priority 3: Effect Tracking**
   - Optimize dependency tracking mechanism
   - Reduce overhead in effect creation and disposal

### Use Case Recommendations

**Use @storable/core when:**
- Working with MongoDB-style updates
- Performing complex nested object updates
- Need specific array push performance
- Database operation compatibility is important

**Use solid-js/store when:**
- Building reactive UI applications
- Need high-performance reactive updates
- Working with many effects and dependencies
- Performance is critical for property access

## Conclusion

While @storable/core shows promise in certain areas (complex updates, MongoDB operators), it faces significant performance challenges in core reactive operations compared to solid-js. The 11,000x+ difference in reactive property access suggests fundamental architectural differences that may require substantial refactoring to address.

The MongoDB update operators feature is well-optimized and provides a unique value proposition, but the core proxy and reactivity system needs significant optimization to be competitive for general reactive state management use cases.
