# FAILED: Signal Prototype Method Optimization

> **STATUS: FAILED (conceptual).** Moving the per-signal `$` setter to a prototype method breaks signal identity. The `$` method must be a closure bound to its specific signal instance -- a prototype method loses that binding when extracted (e.g., `const setter = signal.$`), and `.bind()` would create a new function anyway, defeating the optimization.

**Date:** September 2025

## Goal

Reduce per-signal memory by moving the `$` setter from a per-instance closure to a shared prototype method. Expected savings: ~8-16 bytes per signal.

## Current Implementation

```typescript
function getNode(nodes, property, value) {
  const newSignal = signal(value)
  newSignal.$ = (v) => newSignal(v)  // Per-instance closure, bound to this specific signal
  nodes[property] = newSignal
  return newSignal
}
```

Each signal gets its own `$` function that captures the specific signal in a closure.

## What Was Proposed

```typescript
class EnhancedSignal<T> extends Signal<T> {
  $(value: T): void {
    return this(value)  // Relies on `this` binding
  }
}
```

## Why It Fails

### 1. Extracted method loses binding

```typescript
// Current (works):
const setter = nameSignal.$   // Closure captures nameSignal
setter('Jane')                // Updates nameSignal correctly

// Prototype (breaks):
const setter = nameSignal.$   // Unbound method
setter('Jane')                // `this` is undefined or wrong
```

### 2. `.bind()` defeats the purpose

```typescript
const setter = nameSignal.$.bind(nameSignal)  // Creates new function = same memory as closure
```

### 3. API contract violation

Existing code depends on `signal.$` being a standalone callable:

```typescript
const setter1 = signal1.$
const setter2 = signal2.$
setter1('a')  // Must update signal1 only
setter2('b')  // Must update signal2 only
```

## Alternatives Considered (All Failed)

| Approach | Problem |
|----------|---------|
| Lazy `$` via `Object.defineProperty` getter | Still creates per-instance function + adds getter overhead |
| Shared function with context param: `sharedSetter(signal, value)` | Changes API, breaks existing code |
| WeakMap-based method storage | More memory (WeakMap + getter + function), not less |

## Key Learnings

1. Per-instance `$` assignment is essential overhead, not waste. It guarantees correct signal identity and closure binding.
2. V8 already optimizes repeated function creation patterns. The 8-16 bytes per signal is acceptable.
3. Signal identity consistency is non-negotiable -- even "innocent" memory optimizations can break reactivity.
