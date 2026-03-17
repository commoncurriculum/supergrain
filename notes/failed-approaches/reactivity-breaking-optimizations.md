# FAILED: Reactivity-Breaking Performance Optimizations

> **STATUS: FAILED (conceptual).** All proposed optimizations (fast-path caching, access-count heuristics, lazy signal creation) would break automatic dependency tracking. In an automatic reactive system, every property access in a reactive context MUST register a dependency -- there is no safe shortcut.

**Date:** September 2025

## Goal

Close the performance gap with Reactively (5000x faster property reads) by adding fast paths that skip signal infrastructure when "safe."

## What Was Tried

### 1. Fast-Path Property Access

Skip signal subscription when a cached value is clean:

```typescript
function handler.get(target, property, receiver) {
  const cached = propertyCache.get(`${target}:${property}`)
  if (cached && cached.clean) {
    return cached.value // BREAKS REACTIVITY
  }
  return fullReactiveGet(target, property, receiver)
}
```

**Why it breaks:** Skipping `signal.get()` means no dependency registered. Subsequent updates to that property won't propagate to the reactive computation.

### 2. Hybrid Caching with Access Count

Promote frequently-accessed properties to a fast path after N accesses:

```typescript
if (cached.accessCount > 10 && cached.state === 'clean') {
  return cached.value // BREAKS REACTIVITY
}
```

**Why it breaks:** Access frequency is irrelevant to reactivity requirements. A property accessed 100 times non-reactively still needs tracking when accessed once inside `reactive(() => ...)`.

### 3. Lazy Signal Creation

Only create full signals when a reactive context exists; use lightweight proxies otherwise:

```typescript
function getNode(nodes, property, value) {
  if (!getCurrentSub()) {
    return createLazySignal(value) // BREAKS REACTIVITY
  }
  return signal(value)
}
```

**Why it breaks:** Creates different signal instances for the same property depending on context. Updates to one instance don't propagate to observers of the other.

```typescript
console.log(store.count)         // Creates lazy signal
const doubled = reactive(() => store.count * 2)  // Creates full signal
setStore({ count: 5 })           // Which signal gets notified?
console.log(doubled())           // Still 0, not 10
```

## The Fundamental Constraint

All three approaches share the same flawed assumption: **some property accesses can safely skip signal infrastructure.**

In Supergrain's automatic reactive system:
- Every property access in a reactive context MUST call `signal.get()` to register a dependency
- Every property MUST have exactly one signal instance for its entire lifetime
- There is no heuristic (access count, cache state, context presence) that can safely bypass this

## Why Reactively Can Optimize But Supergrain Cannot

**Reactively (manual/explicit):**
```typescript
const counter = reactive(0)           // User declares what's reactive
const doubled = reactive(() => counter.value * 2)  // Explicit dependency
```
User controls boundaries. Library can optimize within known constraints.

**Supergrain (automatic/transparent):**
```typescript
const [store] = createStore({ count: 0 })
const doubled = reactive(() => store.count * 2)   // System must auto-detect
```
System must intercept ALL property access. Cannot skip tracking because dependencies aren't declared.

**The performance gap is architectural, not implementational.**

## Valid vs Invalid Optimizations

**Valid (optimize the reactive path itself):**
- Faster signal implementation internals
- Optimized proxy trap execution
- Better memory layout and data structures
- Adopting alien-signals' Clean/Check/Dirty state machine

**Invalid (skip the reactive path):**
- Cache property values without dependency tracking
- Create inconsistent signal instances
- Fast paths that bypass signal.get() in reactive contexts
- Any heuristic-based reactivity skipping

## Key Learnings

1. Automatic reactivity has inherent costs that cannot be optimized away without breaking the core value proposition.
2. The 5000x gap vs Reactively is the price of transparent proxy-based tracking -- a feature, not a bug.
3. Focus optimization efforts on making the required signal path faster, not on skipping it.
