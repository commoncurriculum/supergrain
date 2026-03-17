# Jotai Comparison

> **Status:** Reference analysis. Jotai takes a fundamentally different (atomic) approach to state management.
>
> **Key difference:** Jotai decomposes state into individual atoms; Supergrain wraps unified objects in reactive proxies. Jotai excels at fine-grained atomic control; Supergrain excels at deep nested objects with automatic reactivity.

## Architecture

| Aspect | Jotai | Supergrain |
|--------|-------|-----------|
| State Model | Individual atoms | Unified proxy objects |
| Reactivity | Per-atom subscriptions | Proxy-based signal tracking |
| React Integration | `useAtomValue`/`useSetAtom` | `useTracked` |
| Deep Nesting | Requires atomic decomposition | Automatic proxy wrapping |
| Memory Pattern | Many small objects | Few large objects |
| GC Pressure | High (many objects) | Low (fewer objects) |
| Bundle Impact | Tree-shakable per atom | Monolithic store |

## React Integration

Jotai uses `useAtomValue` backed by `useReducer` + `useEffect` for per-atom subscriptions. Each hook subscribes to a single atom via `store.sub()`. Built-in support for async atoms and Suspense.

Supergrain uses `useTracked` with a proxy that auto-tracks accessed properties during render.

## Memory Comparison

**Per-unit cost:**
- Jotai: ~72 bytes per atom (state object with dependency map, version, value, error, pending set)
- Supergrain: ~200 bytes per store/nested object (proxy + signal + handler + WeakMap)

**Store-level overhead:**
- Jotai: Multiple WeakMaps and Sets for atomStateMap, mountedMap, invalidatedAtoms, changedAtoms (~2-3KB infrastructure)
- Supergrain: Single proxy chain with signal nodes

**For 100 properties:**
- Jotai (100 atoms): ~11KB + dependency graph
- Supergrain (1 store, 100 properties): ~2KB + signal nodes

### Deep Nesting Memory

| Approach | Memory | Granularity |
|----------|--------|-------------|
| Single nested atom | ~96 bytes | Coarse (entire object) |
| Decomposed atoms (5 levels) | ~608 bytes | Fine-grained |
| Supergrain (5 levels) | ~1.0KB | Automatic fine-grained |

Jotai memory scales with atom count; Supergrain scales with object complexity.

## Performance Comparison

| Operation | Jotai | Supergrain | Notes |
|-----------|-------|-----------|-------|
| Creation (per unit) | ~0.02ms/atom | ~1.3ms (store) | Atoms are cheap individually |
| Simple reads | ~0.1ms | ~0.08ms | Supergrain ~25% faster |
| Deep reads | ~1ms (decomposed) | ~0.13ms | Supergrain ~8x faster |
| Simple updates | ~0.2-0.5ms | ~0.5ms | Similar |
| Complex updates | ~3-6ms (immutable) | ~1.5ms | Supergrain ~2x faster (in-place) |
| Multiple property access | ~0.1ms x N atoms | ~0.08ms (one proxy) | Supergrain scales better |

## Deep Nested Updates

Jotai requires full object reconstruction for nested updates:

```javascript
set(userAtom, (prev) => ({
  ...prev,
  profile: { ...prev.profile, address: { ...prev.profile.address, lat: 42 } }
}))
```

Supergrain updates in-place:

```javascript
store.user.profile.address.lat = 42
```

## When to Choose Jotai

- Naturally atomic state (independent counters, toggles, flags)
- Need for Suspense/async atom integration
- Want tree-shaking at the atom level
- Relatively flat state structures
- Teams comfortable with functional reactive patterns

## When to Choose Supergrain

- Complex nested object structures
- Frequent deep mutations
- Want automatic reactivity without decomposition planning
- Memory-constrained environments with many nested objects
- Teams preferring unified object models
