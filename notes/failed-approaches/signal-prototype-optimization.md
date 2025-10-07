# Failed Optimization: Signal Prototype Method Optimization

**Date:** September 2025
**Optimization Attempted:** Move signal `$` setter method to prototype to reduce per-instance memory
**Result:** Would break signal identity and reactivity
**Key Lesson:** Signal identity consistency cannot be optimized away, even for seemingly innocent memory improvements

## Background

During analysis of Supergrain's memory usage, the per-signal `$` property assignment was identified as a potential optimization target:

```typescript
function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any
): Signal<any> {
  if (nodes[property]) {
    return nodes[property]!
  }
  const newSignal = signal(value) as Signal<any>
  newSignal.$ = (v: any) => newSignal(v) // ← Per-instance method assignment
  nodes[property] = newSignal
  return newSignal
}
```

Each signal gets its own `$` setter function, which appears wasteful from a memory perspective.

## Proposed Optimization

### Theoretical Implementation

```typescript
class EnhancedSignal<T> extends Signal<T> {
  $prototype(value: T): void {
    return this(value) // Call the signal instance as a setter
  }
}

function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any
): Signal<any> {
  if (nodes[property]) {
    return nodes[property]!
  }
  const newSignal = new EnhancedSignal(value)
  // No per-instance $ assignment needed - use prototype method
  nodes[property] = newSignal
  return newSignal
}
```

### Expected Benefits

- **Memory reduction**: ~8-16 bytes saved per signal (function reference + closure)
- **GC pressure**: Fewer per-instance function objects
- **Initialization speed**: Eliminate property assignment during signal creation
- **Prototype optimization**: V8 can optimize prototype method calls

## Why This Optimization Fails

### 1. **Signal Identity Confusion**

The fundamental problem is that the `$` method must be bound to the specific signal instance:

```typescript
// Current working implementation:
const nameSignal = signal('John')
const ageSignal = signal(30)

nameSignal.$ = v => nameSignal(v) // Bound to nameSignal specifically
ageSignal.$ = v => ageSignal(v) // Bound to ageSignal specifically

// Each $ method knows exactly which signal to update
nameSignal.$('Jane') // ✅ Updates only nameSignal
ageSignal.$(31) // ✅ Updates only ageSignal
```

```typescript
// Broken prototype implementation:
class EnhancedSignal {
  $(value) {
    return this(value) // ❌ Which signal is "this"?
  }
}

const nameSignal = new EnhancedSignal('John')
const ageSignal = new EnhancedSignal(30)

// Both signals share the same $ method - identity confusion
nameSignal.$(value) // ❌ Could update wrong signal depending on binding
```

### 2. **Method Binding Issues**

JavaScript method binding creates additional complexity:

```typescript
// Current approach - explicit binding
const setter = nameSignal.$ // Works: bound function
setter('Jane') // ✅ Updates nameSignal correctly

// Prototype approach - binding required
const setter = nameSignal.$.bind(nameSignal) // Required for correctness
setter('Jane') // ✅ Works but defeats the optimization purpose
```

The `.bind()` call would create a new function anyway, eliminating the memory benefit.

### 3. **Closure Semantics**

The current per-instance approach creates a proper closure:

```typescript
// Each signal gets its own closure that captures the specific signal instance
newSignal.$ = (v: any) => newSignal(v)
//                        ^^^^^^^^^^ Captures specific signal in closure
```

A prototype method cannot maintain this closure relationship without additional binding mechanisms.

### 4. **API Contract Violation**

The existing API expects each signal to have its own `$` property:

```typescript
// User code depends on this working:
const signal1 = getNode(nodes, 'prop1', 'value1')
const signal2 = getNode(nodes, 'prop2', 'value2')

const setter1 = signal1.$ // Must be bound to signal1
const setter2 = signal2.$ // Must be bound to signal2

// These must update different signals
setter1('newValue1') // Only affects signal1
setter2('newValue2') // Only affects signal2
```

## Signal Identity Requirements

This optimization violates the core principle documented in previous failed approaches:

> **Each property must have exactly one signal instance for the entire object lifetime**

While this optimization doesn't directly share signals between properties, it breaks the signal's internal consistency by sharing setter methods between different signal instances.

### Why Signal Identity Matters

1. **Update Propagation**: Each signal must notify its own observers
2. **Dependency Tracking**: Reactive computations must track the correct signal
3. **API Consistency**: Users expect `signal.$` to always update that specific signal
4. **Memory Safety**: Prevents cross-contamination between different reactive properties

## Alternative Approaches Considered

### 1. **Lazy $ Property Assignment**

Only create the `$` method when first accessed:

```typescript
function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any
): Signal<any> {
  const newSignal = signal(value) as Signal<any>

  Object.defineProperty(newSignal, '$', {
    get() {
      if (!this._setter) {
        this._setter = (v: any) => newSignal(v)
      }
      return this._setter
    },
    configurable: false,
  })

  return newSignal
}
```

**Why this fails**: Still creates per-instance functions, adds getter overhead, more complex than original.

### 2. **Shared Method with Context Parameter**

```typescript
const sharedSetter = (signal: Signal<any>, value: any) => signal(value)

// Usage: sharedSetter(nameSignal, "Jane")
```

**Why this fails**: Changes the API, less ergonomic than `signal.$()`, breaks existing code.

### 3. **WeakMap-Based Method Storage**

```typescript
const signalSetters = new WeakMap<Signal<any>, (v: any) => void>()

function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any
): Signal<any> {
  const newSignal = signal(value) as Signal<any>
  signalSetters.set(newSignal, (v: any) => newSignal(v))

  Object.defineProperty(newSignal, '$', {
    get() {
      return signalSetters.get(this)
    },
  })

  return newSignal
}
```

**Why this fails**: Even more memory overhead (WeakMap + getter + function), performance regression.

## Lessons Learned

### 1. **Memory vs. Correctness Trade-off**

While per-instance method assignment uses more memory, it ensures:

- Correct signal identity
- Proper closure semantics
- API reliability
- No binding confusion

The memory cost is the price of maintaining reactivity guarantees.

### 2. **Apparent Waste vs. Essential Overhead**

What appears to be "wasteful" per-instance assignment is actually:

- **Essential for correctness**: Each signal needs its own setter
- **Optimized by V8**: Modern engines optimize function creation and binding
- **Minimal in practice**: 8-16 bytes per signal is acceptable overhead
- **API requirement**: Users expect `signal.$` to work reliably

### 3. **Signal Identity is Non-Negotiable**

This failed optimization reinforces the core constraint from previous attempts:

> **Signal identity consistency cannot be optimized away**

Even seemingly innocent optimizations like shared prototype methods can break the fundamental reactive model.

### 4. **V8 Optimization Considerations**

Modern JavaScript engines already optimize:

- Function creation and binding
- Closure capture and storage
- Method dispatch for similar objects
- Memory layout for repeated patterns

Attempting to "outsmart" these optimizations often leads to worse performance or broken functionality.

## Conclusion

The signal prototype optimization represents a **classic example of premature optimization that would break core functionality**. While the memory savings appeared attractive (~10-20% reduction in signal memory footprint), the optimization fundamentally violates signal identity requirements.

### Key Takeaways

1. **Signal identity consistency is non-negotiable** - Each signal must have its own bound methods
2. **Memory "waste" may be essential overhead** - Per-instance methods ensure correctness
3. **API contracts must be preserved** - Users depend on `signal.$` working reliably
4. **V8 already optimizes function creation** - Manual optimizations often backfire
5. **Correctness trumps memory optimization** - Broken functionality isn't worth memory savings

### Value of This Analysis

While this optimization was never implemented, analyzing it clarifies:

- The boundaries of acceptable signal optimizations
- Why certain memory patterns exist in reactive systems
- How signal identity requirements constrain optimization options
- The importance of understanding closure semantics in reactive libraries

**Status:** Theoretical analysis - never implemented
**Impact:** Prevented implementation of optimization that would break reactivity
**Follow-up:** Focus on optimizations that preserve signal identity and closure semantics
