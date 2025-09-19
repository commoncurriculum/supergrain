# isEqual Function Threshold Analysis

## Summary

Performance benchmarking was conducted to determine the optimal threshold for switching from `array.includes()` to `Set.has()` in the `isEqual` function for object key lookups.

## Key Findings

**Crossover Point: ~50 keys**

- `array.includes()` is faster for objects with fewer than 50 keys
- `Set.has()` becomes faster for objects with 50+ keys
- The performance difference is significant enough to justify the optimization

## Benchmark Results

### Performance by Object Size

| Keys | array.includes() (ops/sec) | Set.has() (ops/sec) | Winner | Performance Difference |
|------|---------------------------|---------------------|---------|----------------------|
| 2    | 16,323                    | 10,103             | Array   | 1.62x faster         |
| 5    | 7,440                     | 3,619              | Array   | 2.06x faster         |
| 10   | 2,715                     | 1,466              | Array   | 1.85x faster         |
| 15   | 1,574                     | 1,016              | Array   | 1.55x faster         |
| 20   | 999                       | 762                | Array   | 1.31x faster         |
| 30   | 434                       | 377                | Array   | 1.15x faster         |
| 40   | 289                       | 270                | Array   | 1.07x faster         |
| 45   | 250                       | 238                | Array   | 1.05x faster         |
| **50** | **219**               | **224**            | **Set** | **1.02x faster**     |
| 55   | 184                       | 201                | Set     | 1.09x faster         |
| 60   | 168                       | 191                | Set     | 1.14x faster         |
| 100  | 102                       | 144                | Set     | 1.41x faster         |

### Set Creation Overhead

Set creation has significant overhead compared to array operations:

- Set creation (20 keys): ~170 ops/sec
- Array creation (20 keys): ~5,240 ops/sec
- **Array creation is ~31x faster than Set creation**

This overhead is amortized when the Set is used for multiple lookups, which happens in the `isEqual` function when comparing all keys.

## Implementation Decision

Based on the benchmark results, the threshold was set to **50 keys**:

```typescript
// Use Set for keysB to avoid quadratic time complexity, but only for large objects
// Benchmark testing shows Set becomes faster than array.includes() at around 50 keys
const keysBSet = keysB.length >= 50 ? new Set(keysB) : null
```

## Reasoning

1. **Performance**: `array.includes()` is consistently faster for small to medium objects (< 50 keys)
2. **Memory efficiency**: Arrays have lower memory overhead than Sets for small collections
3. **Real-world usage**: Most objects in typical applications have fewer than 50 properties
4. **Safety margin**: The 50-key threshold provides a conservative approach, ensuring we only use Sets when they provide clear performance benefits

## Test Files

- `benchmarks/isEqual-threshold.bench.ts` - Comprehensive performance testing across different object sizes
- `benchmarks/isEqual-crossover.bench.ts` - Fine-grained testing around the crossover point

## Running the Benchmarks

```bash
cd packages/core
pnpm bench benchmarks/isEqual-threshold.bench.ts
pnpm bench benchmarks/isEqual-crossover.bench.ts
```