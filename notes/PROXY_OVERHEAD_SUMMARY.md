# Proxy Overhead Benchmark Summary

## Question Answered: "What is our overhead?"

**Answer**: @supergrain/core has **dramatically higher overhead** than the baseline 4-5x proxy overhead mentioned in the problem statement:

- **Simple property access**: **188.5x slower** than direct access
- **Nested object access**: **990.9x slower** than direct access  
- **Array operations**: **161.3x slower** than direct access

## Comparison with 7x Threshold

The problem asked to analyze allocations if overhead > 7x. **Our overhead is 27x to 142x higher** than this threshold, making analysis critical.

## Benchmark Commands

To reproduce these results:

```bash
cd packages/core
pnpm run bench benchmarks/proxy-overhead.bench.ts
pnpm run bench benchmarks/allocation-analysis.bench.ts
```

## Root Cause Analysis

### 1. Proxy Handler Overhead (Primary Issue)
- **Basic proxy**: 140x slower than direct access
- **@supergrain proxy**: 188x slower than direct access
- Each additional check/operation compounds overhead

### 2. Major Contributors to Slowdown

| Component | Overhead Factor | Impact |
|-----------|----------------|---------|
| Basic proxy trap | 45x | Foundation overhead |
| getCurrentSub() calls | 14x | Per-access reactivity check |
| Reflect.get operations | 16x | Property access indirection |
| Symbol property access | 37x | $NODE, $RAW lookups |
| hasOwnProperty checks | 15x | Property ownership validation |

### 3. Memory Allocation Hotspots

**Per wrapped object**:
- Proxy creation: ~150 bytes
- Signal tracking: ~200 bytes per property  
- Symbol properties: ~50 bytes
- WeakMap caching: ~30 bytes
- **Total**: ~430+ bytes per object + 200 bytes per property

## Architectural Issues

1. **Proxy handler complexity**: Every property access goes through 6-8 checks
2. **Signal creation pattern**: getNode() function adds 18.8x overhead
3. **Eager wrapping**: All nested objects become proxies immediately
4. **Multiple indirection layers**: Proxy → getCurrentSub → Reflect.get → hasOwnProperty

## Recommendations by Impact

### High Impact (50-70% improvement potential)

1. **Compile-time optimization**: Pre-generate optimized accessors for known object shapes
2. **Hybrid approach**: Provide direct signal access APIs for performance-critical code
3. **Selective wrapping**: Only wrap objects that need reactivity

### Medium Impact (20-30% improvement potential)

1. **Cache getCurrentSub() results**: Avoid repeated calls per access
2. **Simplify proxy handler**: Remove unnecessary checks and operations  
3. **Lazy signal creation**: Create signals only when properties are tracked
4. **Optimize symbol access**: Minimize $NODE/$RAW lookups

### Low Impact (5-15% improvement potential)

1. **Use property descriptors**: For known object shapes, avoid proxy traps
2. **Pool signal instances**: Reuse signal objects to reduce GC pressure
3. **Inline critical operations**: Reduce function call overhead

## Conclusion

The 188x-990x overhead is primarily due to **proxy architecture fundamentals** rather than implementation inefficiencies. While optimizations can help, achieving sub-10x overhead would likely require architectural changes like:

- Compile-time transformations
- Direct signal exposure APIs  
- Selective opt-in reactivity
- Hybrid proxy/descriptor approaches

The current approach prioritizes **developer experience and API ergonomics** over raw performance, which may be acceptable for many applications but should be documented clearly for performance-critical use cases.