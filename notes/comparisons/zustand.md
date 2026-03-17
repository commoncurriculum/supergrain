# Zustand Comparison

> **Status:** Reference analysis. Zustand is the minimalist benchmark -- lowest memory, fastest reads, but no automatic reactivity.
>
> **Key difference:** Zustand uses plain objects with manual selector-based subscriptions; Supergrain uses proxies with automatic property-level tracking. Zustand wins on baseline memory and read speed; Supergrain wins on deep updates and developer convenience.

## Architecture

| Aspect | Zustand | Supergrain |
|--------|---------|-----------|
| Reactivity Model | Manual selectors | Automatic proxy tracking |
| Memory Baseline | ~64 bytes per store | ~200 bytes per store |
| Memory Growth | Linear with components | Linear with components + objects |
| Change Detection | `Object.is` comparison | Proxy trap execution |
| Re-render Control | Explicit via selectors | Automatic via access tracking |
| Bundle Size | ~2KB | ~5KB + alien-signals |

Zustand's core is remarkably simple: a closure with `state`, a `Set` of listeners, and `setState` that does `Object.assign` + `Object.is` check + listener notification.

## Memory Comparison

| Library | Base Store | Per Component | 100 Components |
|---------|-----------|---------------|----------------|
| Zustand | ~64 bytes | ~48 bytes | ~4.9KB |
| Supergrain | ~200 bytes | ~50 bytes | ~5.2KB |

For simple flat state, Zustand uses 3x less base memory. The gap narrows with more components.

**Deep nesting (6 levels):**

| Library | Baseline | Per Update | GC Impact |
|---------|----------|------------|-----------|
| Zustand | ~64 bytes | ~620 bytes temp (immutable tree) | Medium spikes |
| Supergrain | ~1.2KB | In-place (~50 bytes temp) | Low |

## Performance Comparison

| Operation | Zustand | Supergrain | Notes |
|-----------|---------|-----------|-------|
| Store creation | ~0.2ms | ~1.3ms | Zustand ~10x faster |
| Simple reads | ~0.011ms | ~0.08ms | Zustand ~7x faster (plain objects) |
| Deep reads | ~0.016ms | ~0.13ms | Zustand ~8x faster |
| Shallow updates | ~0.4ms | ~0.5ms | Similar |
| Deep updates | ~3.5-8ms | ~1.0ms | Supergrain 3-8x faster |
| Batch updates | ~1ms (3 setState) | ~0.7ms | Supergrain slightly faster |

Zustand reads are fast because selectors access plain JavaScript objects. But deep updates require verbose immutable spreading, which is both slow and error-prone.

## Key Differences

**Zustand advantages:**
- Lowest memory footprint among all libraries
- Fastest reads (plain object access)
- Predictable performance (no hidden costs)
- Tiny bundle (~2KB)
- Simple mental model
- Rich middleware ecosystem (devtools, persist, immer)

**Zustand disadvantages:**
- Manual selector optimization required
- No automatic fine-grained reactivity
- Verbose immutable spreading for deep updates
- Developer responsible for preventing unnecessary re-renders
- No batching (each `setState` notifies all listeners)

**Supergrain advantages:**
- Automatic property-level tracking (no selectors)
- 3-8x faster deep updates (in-place mutations)
- MongoDB-style operators for complex updates
- Automatic batching
- Lower GC pressure during updates

**Supergrain disadvantages:**
- Higher baseline memory
- Slower reads (proxy overhead)
- Larger bundle

## Deep Update Comparison

```javascript
// Zustand: verbose immutable spreading
set((state) => ({
  ...state,
  user: {
    ...state.user,
    profile: {
      ...state.user.profile,
      address: { ...state.user.profile.address, coordinates: { lat, lng } }
    }
  }
}))

// Supergrain: direct mutation
store.user.profile.address.coordinates = { lat, lng }
```

## Reactivity Comparison

```javascript
// Zustand: manual selector (fires all listeners, selector bails out)
const coordinates = useStore((state) => state.user.profile.address.coordinates)

// Supergrain: automatic tracking (only fires affected effect)
const state = useTracked(store)
const coordinates = state.user.profile.address.coordinates
```

In the state library benchmarks, Zustand fires all 10 subscribers on every update (relying on selector bailout), while Supergrain fires only the 1 affected effect.

## When to Choose Zustand

- Simple, flat state structures
- Memory-constrained environments
- Teams wanting explicit control over re-renders
- Applications where read performance is critical
- Need for middleware ecosystem (devtools, persistence)

## When to Choose Supergrain

- Complex, deeply nested state
- Frequent deep mutations
- Automatic reactivity preferred over manual selectors
- Write-heavy workloads
- Teams wanting zero-config reactive state
