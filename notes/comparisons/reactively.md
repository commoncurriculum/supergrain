# Reactively Comparison

> **Status:** Analysis complete. Reactively is a pure reactive computation library (<1KB) with no store API or React integration.
>
> **TL;DR:** Reactively's 5000x faster reads come from explicit manual reactivity (direct `signal.value` access), not from techniques transferable to supergrain's automatic proxy-based tracking. The performance gap is architectural and cannot be closed without abandoning automatic reactivity. Viable gains are limited to micro-optimizations (5-25% range). For solid-js-level performance, the path forward is `$$()` direct DOM bindings and `createView` prototype getters (see `compiled-reads-investigation.md`).

---

## What Is Reactively

Reactively is a minimal (<1KB gzipped) reactive computation library using a hybrid push-pull execution model with three-phase updates: mark dirty, check stale, update if necessary. Each `Reactive<T>` instance maintains its own sources/observers arrays for dependency tracking. It exposes raw signal primitives with manual setup -- every property needs explicit `reactive()` wrapping.

## Architectural Comparison

| Aspect              | Reactively                             | Supergrain                                   |
| ------------------- | -------------------------------------- | -------------------------------------------- |
| Reactivity Model    | Explicit signal nodes (`signal.value`) | Proxy-based automatic tracking               |
| Object Handling     | Manual wrapping required               | Automatic proxy wrapping                     |
| Bundle Size         | <1KB gzipped                           | ~8KB (with alien-signals)                    |
| Memory per Property | ~109 bytes                             | ~200 bytes (with proxy overhead)             |
| React Integration   | None                                   | Built-in `tracked()` (formerly `useTracked`) |

**Core insight:** Every property access in supergrain must register dependencies via proxy traps. Attempts to skip this infrastructure break the automatic tracking that is supergrain's core value proposition.

## Performance

| Operation         | Reactively      | Supergrain    | Factor                   |
| ----------------- | --------------- | ------------- | ------------------------ |
| Property creation | ~0.0003ms       | ~0.001ms      | Reactively 3x faster     |
| Property reads    | ~0.000017ms     | ~0.084ms      | Reactively ~5000x faster |
| Property updates  | ~0.0001ms       | ~0.001ms      | Reactively 10x faster    |
| Object creation   | ~0.5ms (manual) | ~1.3ms (auto) | Reactively 2.6x faster   |

The massive read performance gap comes from direct `.value` access vs proxy trap overhead.

## Memory

- Reactively: ~109 bytes per reactive node (value + fn + observers + sources + state + cleanups)
- Supergrain: ~200 bytes per object (proxy + signal + handler + WeakMap), scales with object count not property count

For a 4-level nested object with 10 properties per level:

- Reactively: ~1.21 MB for 11,110 manually wrapped nodes
- Supergrain: significantly less due to object-level (not property-level) tracking

## Viable Optimizations (within reactive constraints)

### 1. Proxy Handler Symbol Checks (implemented)

Single `typeof` guard short-circuits for string properties instead of sequential `===` checks on every access.

### 2. Array Length Handling in setProperty (implemented)

Cache length values instead of repeated property access.

### 3. Signal Micro-optimizations

- Arrays instead of Sets for dependency registration where appropriate
- Optimized equality checks for common types
- Better memory layout to reduce per-signal overhead
- Batch subscription updates

**Expected impact:** 10-20% improvement

### 4. Memory Layout / Object Pooling

- Pool frequently created objects in proxy traps
- Reduce allocation frequency in hot paths

**Expected impact:** 15-25% memory reduction

### 5. Bundle Size

- Tree shaking via package splitting (`@supergrain/core`, `@supergrain/react`, `@supergrain/dev`)
- Bit flags instead of objects where possible

**Expected impact:** 20-30% size reduction

### Rejected Optimizations (would break reactivity)

- Property access caching that bypasses signals
- Fast path proxy handling that skips dependency registration
- Lazy signal creation with inconsistent identity

## Implementation Priority

| Phase | Focus                                                                                        | Risk   |
| ----- | -------------------------------------------------------------------------------------------- | ------ |
| 1     | Signal micro-optimizations, observer data structures, allocation reduction, bundle splitting | Low    |
| 2     | Optimized WeakMap alternatives, memory layout, batch dependency registration, object pooling | Medium |
| 3     | Custom signal implementation, V8-specific proxy optimizations                                | High   |

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
