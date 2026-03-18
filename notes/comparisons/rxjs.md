# RxJS Comparison

> **Status:** Reference analysis with proven benchmark findings. RxJS outperforms Supergrain in the krauset benchmark due to bypassing path-based update overhead.
>
> **Key finding:** The performance gap is NOT due to signal batching or string parsing -- it is due to Supergrain's path-based update system (`$set` with dot-path strings) vs RxJS's direct array operations.

## Architecture

| Aspect            | RxJS                                    | Supergrain                          |
| ----------------- | --------------------------------------- | ----------------------------------- |
| State Model       | Immutable streams                       | Mutable proxy objects               |
| Update Pattern    | Event dispatch -> stream transformation | Direct mutation or operators        |
| Memory Pattern    | New objects per change                  | In-place modifications              |
| React Integration | `useStateObservable` (react-rxjs)       | `tracked()`                         |
| Bundle Size       | ~45KB (RxJS + react-rxjs)               | ~8KB (core + react + alien-signals) |

## Krauset Benchmark Analysis

### Proven Bottleneck

Through empirical benchmarking, the real performance difference was isolated:

| Test                   | Time    | Notes                            |
| ---------------------- | ------- | -------------------------------- |
| Alien-signals direct   | 0.006ms | Core reactive systems equivalent |
| RxJS Subject + scan    | 0.008ms | Actually slightly slower         |
| Direct signal updates  | 0.016ms | Fast                             |
| Storable `updateStore` | 0.161ms | **26.83x slower**                |

The bottleneck is **path processing overhead**, not the signal system.

### Why RxJS Is Faster

**RxJS:** Direct array operations, single stream emission.

```javascript
const newData = data.slice();
newData[i] = { id: r.id, label: r.label + " !!!" };
// One emission -> one React update
```

**Supergrain:** Path parsing + individual signal updates.

```javascript
updateStore({ $set: { "data.0.label": "...", "data.10.label": "..." } });
// Each path: string parsing + traversal + individual setProperty
```

### Specific Benchmark Gaps

**Row selection:** RxJS ~2x faster (~0.15ms vs ~0.32ms). RxJS uses direct subject emission; Supergrain processes through the operator framework.

**Partial updates (100 of 1,000 rows):** RxJS ~1.45x faster. RxJS does one array slice + batch object creation; Supergrain does 100 individual `setProperty` calls through path resolution.

### Isolated State Update Comparison

| Approach                             | Time                   |
| ------------------------------------ | ---------------------- |
| React-hooks style (direct mutations) | 0.042ms                |
| RxJS-style (object recreation)       | 0.052ms                |
| Supergrain `updateStore`             | 0.153ms (3.19x slower) |

### What Was Ruled Out

- **String parsing**: `path.split('.')` adds only ~0.0125ms for 100 ops (negligible)
- **Signal batching**: Individual vs batch signals shows minimal difference
- **React reconciliation**: Not a factor in isolated benchmarks

## Performance Comparison

| Operation               | RxJS                     | Supergrain               | Notes                          |
| ----------------------- | ------------------------ | ------------------------ | ------------------------------ |
| Stream/store creation   | ~0.45ms                  | ~1.3ms                   | RxJS ~3x faster                |
| Simple reads            | ~0.06ms                  | ~0.08ms                  | Similar                        |
| Simple updates          | ~0.5ms                   | ~0.5ms                   | Similar                        |
| Complex transformations | ~8-20ms (large datasets) | ~2ms                     | Supergrain faster for in-place |
| Bulk partial updates    | Faster (direct ops)      | Slower (path resolution) | RxJS wins in krauset           |

## Key Differences

**RxJS advantages:**

- Event-driven architecture with powerful stream composition
- Built-in time-based operations (debounce, throttle)
- First-class async/Promise handling
- Functional transformations highly optimizable by JS engines
- Bypasses path-processing overhead for direct operations

**RxJS disadvantages:**

- High memory overhead (immutable state recreation)
- Large bundle size (~45KB)
- Steep learning curve
- No fine-grained property-level reactivity

**Supergrain advantages:**

- Fine-grained property-level reactivity
- In-place mutations (lower memory, less GC)
- Smaller bundle (~8KB)
- Simpler API for typical state management
- Direct mutations now available (bypassing path overhead)

## Conclusion

RxJS outperforms Supergrain in krauset-style benchmarks because it bypasses the path-based update system entirely. The introduction of direct mutations (`store.data[i].label = "..."`) addresses this gap by providing a path-free update mechanism with the same performance characteristics as direct array operations.

For stream-heavy, async-oriented applications, RxJS remains compelling. For typical React state management with fine-grained reactivity, Supergrain offers a simpler, lighter alternative.
