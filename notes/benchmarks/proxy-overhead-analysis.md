# Proxy Overhead Analysis

> **Status:** Historical analysis. Some findings led to optimizations (lazy signal creation, direct mutations). The proxy architecture remains, as the DX tradeoff is intentional.
>
> **Key finding:** @supergrain/core proxy overhead ranges from 50x to 990x vs direct object access, depending on the operation. The primary contributors are proxy handler complexity, signal creation patterns, and symbol property access.

## Summary of Overhead

| Operation                                    | Overhead vs Direct Access |
| -------------------------------------------- | ------------------------- |
| Simple property access (1M reads)            | **188.5x** slower         |
| Nested object access (100k reads)            | **990.9x** slower         |
| Array operations (10k iterations, 100 items) | **161.3x** slower         |
| Store creation (10k stores)                  | **51.2x** slower          |

Even a minimal proxy adds ~140x overhead; supergrain adds ~35-50% on top of that.

## Root Cause Breakdown

### Proxy Handler Complexity

| Proxy Type          | Overhead vs Direct |
| ------------------- | ------------------ |
| Direct access       | 1x (baseline)      |
| Minimal proxy       | 45x                |
| getCurrentSub proxy | 46x                |
| Full storable proxy | 83x                |

Each additional check in the handler compounds the cost.

### Function Call Overhead

| Operation            | Overhead vs Direct |
| -------------------- | ------------------ |
| getCurrentSub calls  | 3.63x              |
| Reflect.get calls    | 15.80x             |
| hasOwnProperty calls | 15.14x             |

### Symbol Property Access

| Property Type  | Overhead vs Regular |
| -------------- | ------------------- |
| Symbol ($NODE) | 37.84x              |
| Symbol ($RAW)  | 36.79x              |

### Signal Creation Patterns

| Pattern                           | Overhead vs Simple |
| --------------------------------- | ------------------ |
| Simple signals (10k)              | 1x (baseline)      |
| Signals with $ setter (10k)       | 1.71x              |
| Signals via getNode pattern (10k) | 18.79x             |

### Object Creation

| Method                         | Relative Performance |
| ------------------------------ | -------------------- |
| Plain object literal           | Best                 |
| Multiple Object.defineProperty | 1.33x slower         |
| Object.create(null)            | 5.08x slower         |
| Object.defineProperty          | 6.11x slower         |

## Memory Footprint Per Wrapped Object

| Component                                         | Estimated Size                       |
| ------------------------------------------------- | ------------------------------------ |
| Proxy overhead                                    | ~150 bytes                           |
| Signal tracking (per property)                    | ~200 bytes                           |
| Symbol properties ($NODE, $RAW, $VERSION, $PROXY) | ~50 bytes                            |
| WeakMap entries                                   | ~30 bytes                            |
| **Total per object**                              | **~430+ bytes + 200 bytes/property** |

Major allocation points: proxy creation, signal creation, symbol property definitions, WeakMap caching, DataNodes objects.

## Recommendations

### Immediate (20-30% improvement potential)

1. Minimize `getCurrentSub()` calls -- cache within a single property access
2. Optimize symbol access -- reduce $NODE/$RAW lookups
3. Simplify proxy handler -- eliminate unnecessary checks
4. Lazy signal creation -- only create when properties are tracked

### Architectural (50-70% improvement potential)

1. Compile-time optimizations -- pre-generate accessors for known shapes
2. Direct signal exposure APIs for performance-critical code
3. Selective proxy wrapping -- only wrap objects needing reactivity

## Reproducing Results

```bash
cd packages/core
pnpm run bench benchmarks/proxy-overhead.bench.ts
pnpm run bench benchmarks/allocation-analysis.bench.ts
```
