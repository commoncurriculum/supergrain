# Reactively Comparison

> **Status:** Reference analysis. Reactively is a pure reactive computation library (<1KB) with no store API or React integration.
>
> **Key difference:** Reactively exposes raw signal primitives with manual setup; Supergrain wraps them in an automatic proxy-based store. Reactively is orders of magnitude faster for raw operations but requires manual wiring for every property.

## Architecture

| Aspect | Reactively | Supergrain |
|--------|------------|-----------|
| Reactivity Model | Explicit signal nodes | Proxy-based automatic tracking |
| Object Handling | Manual wrapping required | Automatic proxy wrapping |
| Bundle Size | <1KB gzipped | ~8KB (with alien-signals) |
| Memory per Property | ~109 bytes | ~200 bytes (with proxy overhead) |
| React Integration | None (manual required) | Built-in `useTracked` hook |

Reactively uses a hybrid push-pull execution model with three-phase updates: mark dirty, check stale, update if necessary. Each `Reactive<T>` instance maintains its own sources/observers arrays for dependency tracking.

## Performance Comparison

| Operation | Reactively | Supergrain | Factor |
|-----------|------------|-----------|--------|
| Property creation | ~0.0003ms | ~0.001ms | Reactively 3x faster |
| Property reads | ~0.000017ms | ~0.084ms | Reactively ~5000x faster |
| Property updates | ~0.0001ms | ~0.001ms | Reactively 10x faster |
| Object creation | ~0.5ms (manual) | ~1.3ms (auto) | Reactively 2.6x faster |

The massive read performance gap comes from direct `.value` access vs proxy trap overhead.

## Memory

- Reactively: ~109 bytes per reactive node (value + fn + observers + sources + state + cleanups)
- Supergrain: ~200 bytes per object (proxy + signal + handler + WeakMap)

For a 4-level nested object with 10 properties per level:
- Reactively: ~1.21 MB for 11,110 manually wrapped nodes
- Supergrain: Scales with object count, not property count

## Trade-offs

**Reactively advantages:**
- Raw performance (5000x faster reads)
- Minimal memory per node
- Tiny bundle size
- Pure reactive system (no framework coupling)

**Reactively disadvantages:**
- Every property needs explicit `reactive()` wrapping
- No React integration
- No store abstraction or update operators
- Verbose for complex object hierarchies

**Supergrain advantages:**
- Automatic reactivity for nested objects
- Built-in React integration
- MongoDB-style update operators
- Natural object syntax

## When to Choose Reactively

- Performance-critical non-React applications (game engines, data visualization)
- Building custom reactive frameworks
- Minimal bundle size is critical
- Team comfortable with explicit signal management

## When to Choose Supergrain

- React applications
- Complex nested state structures
- Need for a store abstraction with update operators
- Developer productivity over raw microsecond performance
