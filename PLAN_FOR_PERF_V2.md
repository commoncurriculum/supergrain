# Performance Plan V2: Achieving Parity with Solid.js Store

## Executive Summary

Despite implementing the optimizations from PLAN_FOR_PERF.md, our benchmarks show we're still **5,878x slower** than Solid.js for reactive property reads. This document outlines a complete architectural overhaul based on deep analysis of Solid.js's implementation.

## Current Performance Gaps

| Operation | @storable/core | solid-js/store | Gap |
|-----------|---------------|----------------|-----|
| Reactive reads (10k) | 2,931 ops/sec | 17,230,822 ops/sec | **5,878x slower** |
| Array removal (1k items) | 4.7 ops/sec | 3,383 ops/sec | **716x slower** |
| Entity retrieval (1k) | 1,916 ops/sec | 35,171 ops/sec | **18x slower** |
| Entity creation (1k) | 1,947 ops/sec | 5,246 ops/sec | **2.7x slower** |

## Root Cause Analysis

After analyzing Solid.js's implementation, we've identified critical architectural differences:

### 1. Tracking Context Detection
- **Solid.js**: Uses `getListener()` from the core reactive system - a direct pointer check
- **@storable/core**: Uses manual `effectDepth` counting with try/finally blocks
- **Impact**: Every property read pays the overhead of our tracking check

### 2. Proxy Creation Strategy
- **Solid.js**: Proxies wrap the **original object** directly, no copying
- **@storable/core**: Creates a **copy** (`[...array]` or `{...object}`) before wrapping
- **Impact**: Unnecessary memory allocation and copying on every proxy creation

### 3. Signal Storage & Access
- **Solid.js**: Direct property access on a hidden object with no intermediate checks
- **@storable/core**: Multiple function calls (`getSignal` → `createSignalFor`) even for hot paths
- **Impact**: Function call overhead on every reactive read

### 4. Proxy Caching
- **Solid.js**: Stores proxy reference **directly on the object** via `$PROXY` symbol
- **@storable/core**: Only uses WeakMap lookup
- **Impact**: WeakMap lookup overhead on every proxy access

### 5. Array Operations
- **Solid.js**: Optimized array reconciliation with minimal signal updates
- **@storable/core**: Triggers shape change signals on every array mutation
- **Impact**: Massive overhead for array operations (716x slower for removals)

## The New Architecture

### Phase 1: Core Infrastructure Alignment

#### 1.1 Integrate with alien-signals' getListener

```typescript
// Instead of manual tracking, use the library's built-in mechanism
import { getListener } from 'alien-signals'

// Remove the entire isTracking.ts file and its effect wrapper
// Use getListener() directly in proxy handlers
```

#### 1.2 Eliminate Object Copying

```typescript
function createReactiveProxy<T extends object>(target: T): T {
  // Check if already proxied via symbol
  let p = target[$PROXY]
  if (p) return p

  // Check WeakMap cache (for external references)
  if (proxyCache.has(target)) {
    p = proxyCache.get(target)
    target[$PROXY] = p  // Store on object for faster access
    return p
  }

  // Create proxy for ORIGINAL object, not a copy
  p = new Proxy(target, handler)

  // Dual caching strategy
  Object.defineProperty(target, $PROXY, {
    value: p,
    configurable: true,
    writable: false,
    enumerable: false
  })
  proxyCache.set(target, p)

  return p
}
```

#### 1.3 Optimize Signal Access Pattern

```typescript
const $NODE = Symbol('store-node')
const $PROXY = Symbol('store-proxy')
const $TRACK = Symbol('store-track')

// Inline signal access for hot path
const handler: ProxyHandler<object> = {
  get(target, property, receiver) {
    // Special symbols fast path
    if (property === $PROXY) return receiver
    if (property === $TRACK) {
      trackSelf(target)
      return receiver
    }

    // Non-reactive fast path
    const listener = getListener()
    if (!listener) {
      const value = target[property]
      return isWrappable(value) ? wrap(value) : value
    }

    // Hot path: existing signal
    const nodes = target[$NODE]
    const tracked = nodes?.[property]
    let value = tracked ? tracked() : target[property]

    // Cold path: create signal on first reactive access
    if (!tracked && listener) {
      const desc = Object.getOwnPropertyDescriptor(target, property)
      if (typeof value !== 'function' || target.hasOwnProperty(property)) {
        if (!desc?.get) {
          value = getNode(nodes || getNodes(target), property, value)()
        }
      }
    }

    return isWrappable(value) ? wrap(value) : value
  }
}
```

### Phase 2: Signal System Optimization

#### 2.1 Lazy Signal Initialization

```typescript
function getNodes(target: object): DataNodes {
  let nodes = target[$NODE]
  if (!nodes) {
    nodes = Object.create(null)
    Object.defineProperty(target, $NODE, {
      value: nodes,
      configurable: true
    })
  }
  return nodes
}

function getNode(nodes: DataNodes, property: PropertyKey, value?: any) {
  if (nodes[property]) return nodes[property]

  // Create signal with no equality checking for maximum speed
  const [read, write] = createSignal(value, { equals: false })
  read.$ = write  // Store writer on reader for Solid compatibility
  nodes[property] = read
  return read
}
```

#### 2.2 Batch All Mutations

```typescript
import { batch } from 'alien-signals'

const handler: ProxyHandler<object> = {
  set(target, property, value) {
    batch(() => setProperty(target, property, value))
    return true
  },

  deleteProperty(target, property) {
    batch(() => setProperty(target, property, undefined, true))
    return true
  }
}
```

### Phase 3: Array Operation Optimization

#### 3.1 Implement Solid's Array Reconciliation

```typescript
function updateArray(current: any[], next: any[]) {
  if (current === next) return

  let i = 0
  const len = next.length

  // Update existing indices
  for (; i < len; i++) {
    if (current[i] !== next[i]) {
      setProperty(current, i, next[i])
    }
  }

  // Only update length if it changed
  if (current.length !== len) {
    setProperty(current, 'length', len)
  }
}
```

#### 3.2 Optimize Array Methods

```typescript
// For array methods that don't need tracking, return bound native methods
if (value != null && typeof value === 'function' && value === Array.prototype[property]) {
  return (...args: unknown[]) =>
    batch(() => Array.prototype[property].apply(receiver, args))
}
```

### Phase 4: ReactiveStore Redesign

#### 4.1 Remove Intermediate Abstractions

Instead of `ReactiveStore` with collections and signals, implement a simpler `createStore` function that directly returns proxied objects:

```typescript
export function createStore<T extends object>(initialState?: T): [T, SetStoreFunction<T>] {
  const unwrapped = unwrap(initialState || {})
  const wrapped = wrap(unwrapped)

  function setStore(...args: any[]) {
    batch(() => {
      Array.isArray(unwrapped) && args.length === 1
        ? updateArray(unwrapped, args[0])
        : updatePath(unwrapped, args)
    })
  }

  return [wrapped, setStore]
}
```

### Phase 5: Additional Optimizations

#### 5.1 Descriptor Caching

```typescript
const descriptorCache = new WeakMap<object, Map<PropertyKey, PropertyDescriptor>>()

function getCachedDescriptor(target: object, property: PropertyKey) {
  let cache = descriptorCache.get(target)
  if (!cache) {
    cache = new Map()
    descriptorCache.set(target, cache)
  }

  let desc = cache.get(property)
  if (!desc) {
    desc = Object.getOwnPropertyDescriptor(target, property)
    if (desc) cache.set(property, desc)
  }
  return desc
}
```

#### 5.2 Property Access Inlining

For critical hot paths, consider using a generated accessor pattern:

```typescript
function createAccessor(target: object, property: PropertyKey) {
  const node = getNode(getNodes(target), property)
  return {
    get: () => node(),
    set: (v: any) => batch(() => node.$(v))
  }
}
```

## Implementation Timeline

### Week 1: Core Infrastructure
- [ ] Integrate with alien-signals' `getListener()`
- [ ] Remove object copying in proxy creation
- [ ] Implement dual caching strategy (symbol + WeakMap)
- [ ] Add batch() to all mutations

### Week 2: Signal Optimization
- [ ] Optimize signal access pattern
- [ ] Implement lazy signal initialization
- [ ] Add descriptor caching
- [ ] Remove equality checking from signals

### Week 3: Array Operations
- [ ] Implement Solid's array reconciliation
- [ ] Optimize array method binding
- [ ] Fix array length tracking

### Week 4: API Redesign
- [ ] Create `createStore` function
- [ ] Deprecate `ReactiveStore` class
- [ ] Add compatibility layer for migration
- [ ] Update benchmarks

## Success Metrics

### Primary Goals
- Reactive property reads: Achieve within **10x** of Solid.js (currently 5,878x slower)
- Array operations: Achieve within **2x** of Solid.js (currently 716x slower)

### Secondary Goals
- Entity operations: Achieve parity with Solid.js
- Memory usage: Maintain or improve current memory profile
- API simplicity: Reduce API surface area while maintaining functionality

## Risk Mitigation

### Breaking Changes
- Provide migration guide from ReactiveStore to createStore
- Implement compatibility layer for gradual migration
- Version as major release (1.0.0)

### Performance Regression
- Benchmark after each phase
- Keep old implementation available as fallback
- A/B test in production before full rollout

### Complexity
- Maintain clear separation between hot and cold paths
- Document performance-critical sections
- Add inline comments explaining optimizations

## Alternative Approaches Considered

### 1. Use Solid.js Store Directly
- **Pros**: Immediate performance parity, battle-tested
- **Cons**: Loses custom features, breaks existing API
- **Decision**: Not viable due to API compatibility requirements

### 2. Fork Solid.js Store
- **Pros**: Start with optimized base, customize as needed
- **Cons**: Licensing concerns, maintenance burden
- **Decision**: Use as reference but implement from scratch

### 3. Switch to Different Signals Library
- **Pros**: Might have better integration points
- **Cons**: alien-signals is already highly optimized
- **Decision**: Stay with alien-signals but use it correctly

## Conclusion

The current implementation's performance gap is not due to fundamental limitations but rather architectural misalignment with modern reactive patterns. By adopting Solid.js's proven patterns—direct object mutation, lazy signal creation, efficient proxy caching, and proper batch updates—we can achieve performance parity while maintaining our unique API features.

The key insight is that **every function call matters** in the hot path. Solid.js succeeds by minimizing overhead through direct property access, symbol-based caching, and careful avoidance of unnecessary abstractions.

This plan represents a complete rewrite of the core proxy and signal system, but the investment is justified by the potential 5,000x+ performance improvement in critical operations.
