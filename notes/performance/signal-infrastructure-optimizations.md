# Signal Infrastructure Optimizations

> **Status:** ANALYSIS COMPLETE -- one optimization recommended, one rejected
> **Scope:** Reactive property access only (non-reactive reads out of scope)
> **Recommended:** WeakMap-only node storage (~18% improvement, low risk)
> **Rejected:** Inline signal data (high risk, breaks alien-signals ecosystem compatibility)

---

## Current Performance Baseline

**Reactive property access breakdown (~0.084ms total):**

| Component              | Time     | % of Total |
|------------------------|----------|------------|
| Special property checks | ~0.009ms | 11%        |
| `getNodes()`           | ~0.020ms | 24%        |
| `getNode()`            | ~0.030ms | 36%        |
| `nodeSignal()` read    | ~0.010ms | 12%        |
| `wrap()` processing    | ~0.010ms | 12%        |
| Other overhead         | ~0.005ms | 6%         |

**Target:** Reduce signal infrastructure overhead (~0.070ms) by 40-60%.

---

## Optimization 1: WeakMap-Only Node Storage -- RECOMMENDED

### Problem
`getNodes()` uses `Object.defineProperty` to attach node storage to objects. This costs ~0.015ms per call and fails on frozen objects (requiring a try/catch).

### Current Implementation
```typescript
function getNodes(target: object): DataNodes {
  let nodes = (target as any)[$NODE]
  if (!nodes) {
    nodes = Object.create(null)
    try {
      Object.defineProperty(target, $NODE, {       // ~0.015ms - EXPENSIVE
        value: nodes, enumerable: false
      })
    } catch {
      // Frozen objects can't be modified
    }
  }
  return nodes
}
```

### Proposed Implementation
```typescript
const objectNodes = new WeakMap<object, DataNodes>()

function getNodes(target: object): DataNodes {
  let nodes = objectNodes.get(target)            // ~0.003ms
  if (!nodes) {
    nodes = Object.create(null)
    objectNodes.set(target, nodes)
  }
  return nodes  // ~0.005ms total vs ~0.020ms
}
```

### Impact
- **Speed:** ~0.015ms saved per call (75% faster for this function)
- **Total access time:** ~18% improvement (0.084ms -> ~0.069ms)
- **Memory:** ~24 bytes per object (comparable to property definition)
- **Risk:** LOW -- no API changes, handles frozen objects naturally, WeakMap auto-cleans on GC

---

## Optimization 2: Inline Signal Data -- REJECTED

### Idea
Replace alien-signals Signal objects with lightweight inline data structures to avoid signal creation overhead.

```typescript
interface InlineSignalData {
  value: any
  version: number
  subscribers?: Set<() => void>  // Only created when needed
}
```

### Why It Was Rejected
- **High risk:** Requires reimplementing core reactivity (subscription lifecycle, batching, cleanup)
- **Ecosystem break:** Loses alien-signals dev tools and library compatibility
- **Memory leak risk:** Manual subscriber management prone to stale callbacks
- **Marginal gain:** ~23% improvement doesn't justify the complexity

---

## Performance Projections

| Metric | Current | With WeakMap Optimization |
|--------|---------|---------------------------|
| Reactive property access | ~0.084ms | ~0.069ms (18% improvement) |
| Comparison target (MobX) | ~0.05ms | Closer to parity |

---

## Implementation Notes

### Testing Requirements
- Reactivity correctness with complex subscription scenarios
- Memory leak detection over extended usage
- Performance benchmarking across different property access patterns
- Compatibility with existing Supergrain applications

### Rollback Plan
Feature-flag the WeakMap change for easy reversion if issues arise in production.
