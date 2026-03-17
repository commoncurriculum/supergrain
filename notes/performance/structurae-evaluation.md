# Structurae Library Evaluation

> **Status:** COMPLETED -- do not integrate
> **Outcome:** Only Pool showed potential; benchmarking proved it 1.5x slower than regular allocation. No structurae data structure benefits Supergrain's architecture.
> **Decision:** Focus optimization efforts on proxy alternatives and algorithmic improvements.

---

## Analysis Process

1. Architectural analysis of Supergrain's bottlenecks
2. Evaluation of all relevant structurae data structures
3. Proof-of-concept implementation of signal pooling with Pool
4. Performance benchmarking of pooled vs regular allocation
5. Risk assessment of implementation complexity vs benefits

---

## Supergrain's Performance Profile

### Bottlenecks
1. **Proxy overhead:** 60x slower than plain objects (primary issue)
   - Plain object: 20,824 ops/sec
   - Proxy object: 258 ops/sec
2. **Signal creation/management:** Hot path for reactive property access
3. **Memory allocation:** New signal objects created frequently

### Strong Areas (No Optimization Needed)
- Store creation: 1,723 Hz (82x faster than solid-js)
- Batch updates: 356,247 Hz
- Write operations: Near solid-js performance

---

## Data Structure Assessment

| Data Structure | Assessment | Benchmark Result | Decision |
|----------------|------------|------------------|----------|
| Pool | TESTED | 1.5x slower allocation | Do not implement |
| SortedArray | MARGINAL | Minor cache benefits | Not worth complexity |
| BitField/BitArray | N/A | No applicability | Not applicable |
| Binary Protocol | INCOMPATIBLE | Breaks JS interop | Architecture mismatch |
| Graph/Grid | N/A | No relevance | Wrong use case |

### Pool -- TESTED, REJECTED

Signal pooling was the highest-potential optimization. Pre-allocate signal objects and reuse them instead of creating new ones.

**Hypothesis:** Reduce GC pressure and improve memory locality.

**Benchmark results:**
```
Regular signal allocation:  12,407 ops/sec  FASTER
Pooled signal allocation:    8,334 ops/sec  SLOWER (-1.5x)

Memory pressure (regular):   1,181 ops/sec  FASTER
Memory pressure (pooled):      682 ops/sec  SLOWER (-1.73x)
```

See [signal-pooling.md](../benchmarks/signal-pooling.md) for full benchmark code.

**Why pooling failed:**
1. **Pool lookup costs more than direct allocation** -- V8 is highly optimized for small object creation
2. **State reset overhead** -- resetting pooled signals adds work that fresh signals don't need
3. **Wrong lifecycle pattern** -- signals are typically long-lived, not rapidly allocated/deallocated
4. **Modern GC efficiency** -- V8's generational GC handles signal-sized allocations very well

### SortedArray -- NOT TESTED, REJECTED

Could replace `Record<PropertyKey, Signal>` with sorted key lookup for better cache locality. Marginal benefit (2-3% in specific scenarios), not worth implementation complexity given that property lookup via plain object keys is already fast.

### BitField/BitArray, Binary Protocol, Graph/Grid -- NOT APPLICABLE

- BitField/BitArray: No applicability to reactive store patterns. Symbol-based property tracking doesn't benefit from bit operations.
- Binary Protocol (MapView/ObjectView): Breaks JavaScript object reference semantics required for reactivity.
- Graph/Grid: Not relevant to property-based access patterns.

---

## Performance Projections vs Reality

| Metric | Estimated Impact | Actual Result |
|--------|-----------------|---------------|
| Property access with pooling | +10% improvement | -33% regression (1.5x slower) |
| Memory allocation reduction | -70% | N/A (not implemented) |
| GC pressure reduction | Significant | N/A (pooling rejected) |

---

## Key Learnings

### Why Data Structures Can't Solve This
1. **Proxy overhead dominates** -- 60x overhead cannot be solved with data structures
2. **Architecture mismatch** -- reactivity requires object reference semantics that binary/view structures break
3. **Access pattern mismatch** -- most structures are designed for different workloads

### What Has Worked (Elsewhere)
- Micro-optimizations in hot paths (symbol checks, property access patterns)
- Algorithm improvements (batch updates, reconciliation strategies)
- Memory layout choices (`Object.create(null)` for DataNodes)

### What Has Not Worked
- Better data structures alone (core bottleneck is proxy, not data structure)
- Object pooling (overhead exceeds benefits for typical signal lifecycle)
- Complex caching strategies (previous WeakMap attempt also showed limited gains)

### Recommended Focus Areas
1. **Proxy alternatives:** Compile-time transformations, selective non-proxy paths
2. **Algorithm optimization:** Continue micro-optimizations in proven hot paths
3. **Bundle splitting:** Better tree shaking for performance-critical code paths
