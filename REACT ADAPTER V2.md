# REACT ADAPTER V2

## Reference Source Files

### Preact Signals React Runtime

- **URL**: https://raw.githubusercontent.com/preactjs/signals/refs/heads/main/packages/react/runtime/src/index.ts
- **Purpose**: React integration patterns, hooks, and lifecycle management

### Preact Signals Core

- **URL**: https://raw.githubusercontent.com/preactjs/signals/refs/heads/main/packages/core/src/index.ts
- **Purpose**: Signal implementation and reactive system architecture

### Alien Signals System

- **URL**: https://raw.githubusercontent.com/stackblitz/alien-signals/refs/heads/master/src/system.ts
- **Purpose**: Efficient reactive node system and dependency tracking

### Alien Signals Index

- **URL**: https://raw.githubusercontent.com/stackblitz/alien-signals/refs/heads/master/src/index.ts
- **Purpose**: Signal, computed, and effect implementations

### Storable Core Index

- **Local Path**: packages/core/src/index.ts
- **Purpose**: Current storable library exports and structure

## Overview

This document outlines the architecture and implementation strategy for creating a React adapter for the Storable library, incorporating best practices from Preact Signals and Alien Signals implementations.

## Core Requirements

1. **Seamless React Integration**: Components should automatically re-render when accessed store properties change
2. **Fine-grained Reactivity**: Only track properties actually accessed during render
3. **Batched Updates**: Multiple store mutations should result in a single re-render
4. **Memory Efficiency**: Proper cleanup of subscriptions and prevent memory leaks
5. **React Strict Mode Compatibility**: Handle double-rendering and effect cleanup correctly
6. **Concurrent Features Support**: Work with React 18+ concurrent rendering

## Architecture Overview

### 1. Effect Store Pattern (from Preact)

The adapter should use an Effect Store that:

- Tracks signal dependencies during component render
- Manages subscriptions via `useSyncExternalStore`
- Provides version-based change detection using 32-bit integers
- Handles cleanup on unmount

#### 32-bit Integer Version Optimization (Critical Preact Pattern)

Preact uses a clever optimization with 32-bit integers for version tracking:

```typescript
let version = 0

// When incrementing version, use bitwise OR to ensure 32-bit integer
function incrementVersion() {
  version = (version + 1) | 0 // The `| 0` coerces to 32-bit signed int
}
```

**Why this matters:**

1. **Performance**: JavaScript engines optimize 32-bit integers (SMI - Small Integer) differently than regular numbers
2. **Memory**: 32-bit integers use less memory and are stored inline in V8
3. **Comparison Speed**: Integer comparison is faster than floating-point
4. **Overflow Handling**: Automatically wraps around at 2^31 - 1 (about 2 billion updates)
5. **Cache Efficiency**: Better CPU cache utilization with smaller values

```typescript
interface EffectStore {
  // Version number that increments on any tracked change (32-bit int)
  version: number

  // Start tracking dependencies
  startTracking(): void

  // End tracking and cleanup unused dependencies
  endTracking(): void

  // Subscribe to changes
  subscribe(onStoreChange: () => void): () => void

  // Get current snapshot for useSyncExternalStore (returns 32-bit int)
  getSnapshot(): number
}

// Implementation detail from Preact:
class EffectStoreImpl {
  private version = 0

  private incrementVersion() {
    // Critical: use bitwise OR to maintain 32-bit integer
    this.version = (this.version + 1) | 0
  }

  getSnapshot() {
    return this.version // Always returns 32-bit int
  }
}
```

### 2. Component Integration Strategy

#### Primary Hook: `useStore`

```typescript
function useStore<T>(store: T): T {
  // Create or reuse effect store for this component
  const effectStore = useEffectStore()

  // Subscribe to changes via useSyncExternalStore
  // getSnapshot returns a 32-bit integer version for optimal performance
  useSyncExternalStore(
    effectStore.subscribe,
    effectStore.getSnapshot, // Returns (version | 0) for 32-bit int
    effectStore.getSnapshot
  )

  // Start tracking before render
  effectStore.startTracking()

  // Component will access store properties here
  // Those accesses will be automatically tracked

  // End tracking after render (in finally block)
  try {
    return store
  } finally {
    effectStore.endTracking()
  }
}
```

#### Auto-tracking Wrapper Component

```typescript
function StoreBoundary({ children, store }) {
  const trackedStore = useStore(store)
  return children(trackedStore)
}
```

### 3. Dependency Tracking Mechanism

Building on Alien Signals' reactive system:

1. **Intercept Property Access**: When a component accesses a store property during render, capture that dependency
2. **Link Dependencies**: Create bidirectional links between the component's effect and the accessed signals
3. **Version Tracking**: Track version numbers to detect changes efficiently

```typescript
interface TrackingContext {
  // Currently rendering component's effect
  currentEffect: Effect | undefined

  // Stack for nested tracking contexts
  effectStack: Effect[]

  // Add dependency link
  addDependency(signal: Signal): void

  // Check if currently tracking
  isTracking(): boolean
}
```

### 4. Batching Strategy

Leverage existing alien-signals batching with React-specific enhancements:

```typescript
// Automatic batching for multiple updates
function batchedUpdate(fn: () => void) {
  startBatch()
  try {
    fn()
  } finally {
    endBatch()
    // Schedule React updates after batch completes
    scheduleReactUpdate()
  }
}
```

### 5. Memory Management

Critical for preventing leaks:

1. **Automatic Cleanup**: Use `useLayoutEffect` for synchronous cleanup
2. **Weak References**: Store component references in WeakMap when possible
3. **Disposal Pattern**: Implement Symbol.dispose for modern cleanup

```typescript
const effectStoreCache = new WeakMap<ReactComponent, EffectStore>()

// Cleanup on unmount
useLayoutEffect(() => {
  return () => {
    effectStore.dispose()
    effectStoreCache.delete(component)
  }
}, [])
```

## Implementation Details

### Phase 1: Core Hook Implementation

1. Create `useStore` hook that:
   - Creates an effect store per component
   - Integrates with useSyncExternalStore
   - Manages tracking lifecycle

2. Implement tracking context:
   - Global current effect tracking
   - Property access interception
   - Dependency linking

### Phase 2: Optimization Features

1. **Selector Support**:

```typescript
function useStoreSelector<T, R>(store: T, selector: (store: T) => R): R {
  // Only re-render if selected value changes
}
```

2. **Computed Values**:

```typescript
function useComputed<T>(computeFn: () => T): T {
  // Memoized computed values with dependency tracking
}
```

3. **Effect Management**:

```typescript
function useStoreEffect(effectFn: () => void | (() => void)): void {
  // Run effects when dependencies change
}
```

### Phase 3: Advanced Features

1. **React DevTools Integration**:
   - Custom hooks for debugging
   - Store state inspection
   - Dependency graph visualization

2. **Concurrent Mode Support**:
   - Handle interrupted renders
   - Manage multiple render attempts
   - Proper cleanup of partial work

3. **Server-Side Rendering**:
   - Hydration support
   - Initial state serialization
   - Client-server consistency

## Key Design Decisions

### 1. Use `useSyncExternalStore` (from Preact approach)

**Rationale**: This is React's official API for subscribing to external stores, ensuring compatibility with concurrent features and proper scheduling.

### 2. Version-based Change Detection with 32-bit Integers (from Preact approach)

**Rationale**: More memory-efficient than storing previous values, and enables fast change detection with simple integer comparison. The 32-bit integer optimization ensures:

- V8 can use SMI (Small Integer) representation for faster operations
- Predictable overflow behavior (wraps at ~2 billion)
- Better CPU cache utilization
- Faster equality checks in hot code paths

### 3. Leverage Alien Signals' Reactive System

**Rationale**: Since Storable already uses alien-signals, we can leverage its efficient dependency tracking and batching mechanisms rather than reimplementing.

### 4. Effect Store per Component (from Preact approach)

**Rationale**: Isolates tracking context per component, preventing cross-component pollution and enabling fine-grained subscriptions.

### 5. Automatic Tracking via Proxy Access

**Rationale**: Provides the best developer experience - no need to manually specify dependencies or use special syntax.

## Performance Considerations

1. **Minimize Re-renders**: Only trigger updates for components that accessed changed properties
2. **Batch DOM Updates**: Leverage React's batching with alien-signals' batch mechanism
3. **Lazy Subscription**: Only subscribe to signals when they have observers
4. **Efficient Cleanup**: Remove subscriptions immediately when components unmount
5. **Optimize Hot Paths**: Keep property access fast with minimal overhead
6. **32-bit Integer Versions**: Use `(version + 1) | 0` pattern for version tracking to ensure V8 SMI optimization
7. **Version Comparison**: Use simple integer equality (`===`) for fastest possible change detection

## Error Handling

1. **Cycle Detection**: Detect and report circular dependencies
2. **Memory Leak Prevention**: Warn about potential leaks in development
3. **Strict Mode Compatibility**: Handle double-invocation gracefully
4. **Error Boundaries**: Proper error propagation and recovery

## Testing Strategy

1. **Unit Tests**:
   - Hook behavior
   - Dependency tracking
   - Subscription management
   - Memory leak detection

2. **Integration Tests**:
   - React component rendering
   - Batched updates
   - Concurrent features
   - SSR compatibility

3. **Performance Tests**:
   - Large dependency graphs
   - Rapid updates
   - Memory usage
   - Initial render performance

## Migration Path

For existing React applications using other state management:

1. **Gradual Adoption**: Can be used alongside existing state management
2. **Compatibility Layer**: Optional adapters for Redux/MobX patterns
3. **DevTools**: Migration helpers and debugging tools
4. **Documentation**: Clear migration guides with examples

## API Surface

### Core Hooks

```typescript
// Primary hook for using stores in components
export function useStore<T>(store: T): T

// Create a new store within a component
export function useCreateStore<T>(initialState: T): [T, SetStoreFunction]

// Select specific values from store
export function useStoreSelector<T, R>(store: T, selector: (store: T) => R): R

// Computed values with automatic dependency tracking
export function useComputed<T>(compute: () => T): T

// Effects that run when dependencies change
export function useStoreEffect(effect: () => void | (() => void)): void
```

### Utilities

```typescript
// Batch multiple updates
export function batch(fn: () => void): void

// Check if currently tracking dependencies
export function isTracking(): boolean

// Manually track store access
export function track<T>(store: T): T

// Get untracked store value
export function untrack<T>(fn: () => T): T
```

### Components

```typescript
// Boundary component for store tracking
export function StoreProvider({ store, children })

// Auto-tracking wrapper
export function Observer({ children })
```

## Conclusion

This React adapter design combines the best practices from Preact Signals (React integration patterns, lifecycle management) and Alien Signals (efficient reactive system, batching) to create a powerful, performant, and developer-friendly solution for using Storable stores in React applications.

The key innovation is leveraging the existing alien-signals reactive system that Storable already uses, while adding React-specific integration layers that handle component lifecycles, concurrent rendering, and other React-specific concerns.

This approach provides:

- Zero-configuration reactivity
- Fine-grained updates
- Excellent performance
- Full React 18+ compatibility
- Clean, intuitive API
