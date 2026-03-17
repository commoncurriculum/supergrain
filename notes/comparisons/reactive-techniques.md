# Optimization Techniques from State Management Libraries

> **Status:** Reference catalog. Evaluates techniques from other libraries that could improve Supergrain's performance, memory usage, and DX.
>
> **Priority items:** Lazy proxy creation and property access caching offer the highest impact with moderate complexity.

## Read Performance Comparison

| Library | Simple Read | Deep Read | Key Advantage |
|---------|-------------|-----------|---------------|
| Redux Toolkit | ~0.011ms | ~0.011ms | Plain object access |
| Zustand | ~0.011ms | ~0.016ms | Plain object access |
| Valtio (Snapshot) | ~0.016ms | ~0.016ms | Consistent performance |
| MobX | ~0.05ms | ~0.2ms | Auto dependency tracking |
| Supergrain | ~0.08ms | ~0.13ms | Auto reactivity |
| Jotai | ~0.1ms | ~1ms* | Atomic granularity |

*Jotai deep reads require atomic decomposition.

Plain-object libraries (Redux, Zustand) have fastest reads but no automatic reactivity. Supergrain's proxy overhead (~0.08ms) is reasonable for automatic fine-grained reactivity.

---

## Techniques

### 1. Lazy Proxy Creation (from Valtio)

Create proxies only when objects are first accessed, not during initial store creation.

**Impact:** 300-500% faster creation, 300% faster reads, 50-70% lower initial memory.

**Trade-offs:** Slight overhead on first access; more complex proxy management.

**Status:** Supergrain already uses lazy proxying via `wrap()` on property access.

### 2. Selector Memoization (from Reselect/RTK)

Automatic memoization of computed/derived values based on dependencies.

**Potential implementation:** `$computed` properties that look like regular properties but cache results until dependencies change.

**Impact:** Variable -- eliminates redundant recomputation.

### 3. Structural Sharing (from Zustand/Redux)

Reuse unchanged parts of objects during updates to minimize allocation.

**Impact:** Lower GC pressure, better memory efficiency, faster equality checks.

### 4. Subscription Batching (from MobX Actions)

Batch multiple state changes into a single notification cycle.

**Status:** Already well-implemented in Supergrain via `startBatch`/`endBatch`. Enhancement: expose manual `withBatch()` API for complex multi-step operations.

### 5. Atom-Level Granularity (from Jotai)

Optional decomposition of specific paths into atomic units for ultra-fine-grained tracking.

**Impact:** Per-property re-render control for hot paths.

**Complexity:** High -- requires hybrid proxy/atomic architecture.

### 6. WeakRef Cleanup

Automatic cleanup of unused proxy objects using `WeakRef` and `FinalizationRegistry`.

**Impact:** 10-30% lower long-term memory; prevents leaks in long-running apps.

**Complexity:** Low.

### 7. Snapshot Caching (from Valtio)

Cache immutable snapshots for integration with immutable-expecting libraries.

**Impact:** Better interop, debugging aid, avoids repeated serialization.

### 8. Selective Reactivity (from MobX)

Choose which properties are reactive vs plain values.

**Impact:** 100-200% faster creation, 20-40% lower memory for mixed data.

**Complexity:** High -- changes core wrapping assumptions.

### 9. Property Access Caching

Cache property access results to reduce proxy trap overhead on repeated reads.

**Impact:** 500-800% faster repeated reads.

**Complexity:** Low.

### 10. DevTools Integration (from Redux DevTools)

State inspection, time travel debugging, update logging.

**Impact:** Major DX improvement.

**Complexity:** Medium (separate package).

### 11. Type-safe Path Strings

TypeScript-powered autocompletion for nested property paths.

**Status:** Already implemented in Supergrain's update operators.

---

## Priority Matrix

| Priority | Technique | Creation | Reads | Memory | Complexity |
|----------|-----------|----------|-------|--------|------------|
| **High** | Lazy Proxy Creation | +300-500% | +300% | -50-70% | Medium |
| **High** | Property Access Caching | -- | +500-800% | +5-10% | Low |
| **High** | WeakRef Cleanup | -- | -- | -10-30% | Low |
| **High** | DevTools Integration | -- | -- | +5% | Medium |
| **Medium** | Computed Properties | -- | Variable | +10-20% | Medium |
| **Medium** | Snapshot Caching | -- | -- | -- | Medium |
| **Medium** | Selective Reactivity | +100-200% | +200-400% | -20-40% | High |
| **Lower** | Atomic Granularity | -- | -- | -- | High |
| **Lower** | Manual Batching API | -- | -- | -- | Low |

## Combined Impact Estimate

Implementing lazy proxying + property access caching could make Supergrain:
- **Creation:** Competitive with Valtio (~2-5ms)
- **Cached reads:** Competitive with plain-object libraries (~0.01ms)
- **Memory:** More efficient baseline
- **Maintains:** All automatic reactivity and fine-grained update advantages
