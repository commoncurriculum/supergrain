# Structurae Library Evaluation

> **Status:** COMPLETED -- not recommended for integration
> **Outcome:** Only Pool showed potential; benchmarking proved it 1.5x slower than regular allocation. No structurae data structure benefits Supergrain's architecture.
> **Key insight:** The primary bottleneck (proxy overhead, 60x vs plain objects) cannot be solved with better data structures.

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

### Pool -- TESTED, REJECTED
Signal pooling was the highest-potential optimization. Pre-allocate signal objects and reuse them instead of creating new ones.

**Hypothesis:** Reduce GC pressure and improve memory locality.
**Result:** 1.5x slower allocation, 1.73x slower under memory pressure. Pool management overhead exceeds V8's efficient allocation. See [signal-pooling-benchmark-code.md](signal-pooling-benchmark-code.md) for full results.

### SortedArray -- NOT TESTED, REJECTED
Could replace `Record<PropertyKey, Signal>` with sorted key lookup for better cache locality.

**Assessment:** Marginal benefit (2-3% in specific scenarios). Not worth the implementation complexity given that property lookup via plain object keys is already fast.

### BitField/BitArray -- NOT APPLICABLE
Excellent for bit manipulation but no applicability to reactive store patterns. Current symbol-based property tracking doesn't benefit from bit operations.

### Binary Protocol (MapView/ObjectView) -- NOT APPLICABLE
Designed for serialization/deserialization. Would break JavaScript object reference semantics required for reactivity.

### Graph/Grid Structures -- NOT APPLICABLE
Not relevant to reactive store's property-based access patterns.

---

## Performance Projections (Pre-Benchmark Estimates vs Reality)

| Metric | Estimated Impact | Actual Result |
|--------|-----------------|---------------|
| Property access with pooling | +10% improvement | -33% regression (1.5x slower) |
| Memory allocation reduction | -70% | N/A (not implemented) |
| GC pressure reduction | Significant | N/A (pooling rejected) |

---

## Conclusion

Structurae offers well-engineered data structures, but none are suitable for Supergrain's specific architecture:
- **Data structures cannot solve proxy overhead** (the dominant bottleneck)
- **Signal pooling adds more overhead than it removes** in realistic usage
- **Optimization efforts should focus on** proxy alternatives or algorithmic improvements (compile-time transformations, selective non-proxy paths)

See [structurae-final-assessment.md](structurae-final-assessment.md) for the consolidated final decision.
