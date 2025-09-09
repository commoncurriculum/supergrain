# Optimization Techniques from State Management Libraries

## Overview

This document analyzes optimization techniques used by popular state management libraries that could potentially be borrowed or adapted to improve Storable's performance, memory usage, and developer experience. Each technique is evaluated for its applicability, implementation complexity, and potential benefits.

## Performance Optimization Techniques

### 1. Lazy Proxy Creation (from Valtio)

**Technique:** Only create proxies when objects are first accessed, not during initial state creation.

**Source Analysis:** [`node_modules/valtio/vanilla.js:120-121`](node_modules/valtio/vanilla.js#L120-L121)
```javascript
const nextValue = !proxyStateMap.has(value) && canProxy(value) ? proxy(value) : value;
// Creates proxies on-demand during property access
```

**Current Storable Behavior:**
**Source: [`packages/core/src/store.ts:51-53`](../../packages/core/src/store.ts#L51-L53)**
```typescript
function wrap<T>(value: T): T {
  return isWrappable(value) ? createReactiveProxy(value) : value
}
// Called on every property access - creates proxies immediately
```

**Potential Benefits for Storable:**
- **Faster Initial Creation**: ~3-5x faster store creation for deep structures
- **Lower Memory Baseline**: Only pay proxy cost for accessed objects
- **Better Cold Start**: Applications with large state but sparse access patterns

**Implementation Strategy:**
```typescript
// Enhanced wrap function with lazy creation
function wrapLazy<T>(value: T, path?: string): T {
  if (!isWrappable(value)) return value
  
  // Check if already proxied
  if (proxyCache.has(value)) return proxyCache.get(value)
  
  // For deep objects, create lazy proxy marker
  if (!hasBeenAccessed(path)) {
    return createLazyProxy(value, path)
  }
  
  return createReactiveProxy(value)
}
```

**Trade-offs:**
- ✅ Much faster initial creation
- ✅ Lower memory usage for sparse access
- ❌ Slight access overhead for first-time property access
- ❌ More complex proxy management logic

### 2. Selector Memoization (from Reselect/Redux Toolkit)

**Technique:** Automatic memoization of computed values based on dependencies.

**Source Analysis:** [`node_modules/reselect/src/index.ts`](node_modules/reselect/src/index.ts)
```javascript
const createSelector = (...selectors, resultFunc) => {
  const memoizedResultFunc = memoize(resultFunc)
  return (...args) => {
    const params = selectors.map(selector => selector(...args))
    return memoizedResultFunc(...params)
  }
}
```

**Potential Application to Storable:**
```typescript
// Enhanced store with computed properties
const [store] = createStore({
  users: [],
  // Computed property with automatic memoization
  $computed: {
    activeUsers: (state) => state.users.filter(u => u.active),
    userCount: (state) => state.activeUsers.length
  }
})

// Access triggers memoized computation
const activeUsers = store.activeUsers // Cached until users array changes
```

**Benefits:**
- **Automatic Performance**: No manual optimization needed for derived state
- **Consistent API**: Computed values look like regular properties
- **Memory Efficient**: Only recompute when dependencies change

### 3. Structural Sharing (from Zustand/Redux)

**Technique:** Reuse unchanged parts of objects during updates to minimize memory allocation.

**Source Analysis:** Immutable update patterns
```javascript
// Zustand-style structural sharing
set((state) => ({
  ...state,
  user: {
    ...state.user,
    profile: {
      ...state.user.profile,
      name: newName // Only this part is new
    }
  }
}))
```

**Application to Storable's Update Operators:**
```typescript
// Enhanced update operators with structural sharing awareness
update(store, {
  $merge: {
    'user.profile': { 
      name: 'John',
      // Automatically preserves unchanged properties via structural sharing
    }
  }
})

// Internal implementation could track unchanged properties
// and reuse references where possible during batch operations
```

**Benefits:**
- **Lower GC Pressure**: Fewer temporary objects during complex updates
- **Better Memory Efficiency**: Reuse unchanged object references
- **Faster Equality Checks**: Reference equality for unchanged parts

### 4. Subscription Batching (from MobX Actions)

**Technique:** Batch multiple state changes into single notification cycle.

**Source Analysis:** [`node_modules/mobx/src/core/action.ts`](node_modules/mobx/src/core/action.ts)
```typescript
function action<T>(fn: T): T {
  return function(this: any, ...args: any[]) {
    startBatch()
    try {
      return fn.apply(this, args)
    } finally {
      endBatch()
    }
  }
}
```

**Current Storable Implementation:**
Already well-implemented with automatic batching in `update()` function.

**Potential Enhancement:**
```typescript
// Expose manual batching for complex operations
export function withBatch<T>(store: T, fn: (store: T) => void): void {
  startBatch()
  try {
    fn(store) // Allow direct proxy mutations within batch
  } finally {
    endBatch()
  }
}

// Usage for complex multi-step operations
withBatch(store, (s) => {
  s.users.forEach(user => {
    user.lastSeen = Date.now()
    user.notifications.unread = 0
  })
})
```

### 5. Atom-Level Granularity (from Jotai)

**Technique:** Break state into atomic units for precise dependency tracking.

**Source Analysis:** Jotai's atomic composition
```javascript
const userAtom = atom({ name: 'John', age: 30 })
const nameAtom = atom(
  (get) => get(userAtom).name,
  (get, set, newName) => set(userAtom, {...get(userAtom), name: newName})
)
```

**Potential Storable Enhancement:**
```typescript
// Optional atomic decomposition for performance-critical paths
const [store, atoms] = createStore(
  {
    user: { name: 'John', age: 30, profile: { /* ... */ } }
  },
  {
    atoms: ['user.name', 'user.age'] // Extract specific paths as atoms
  }
)

// These paths get atomic-level tracking for ultra-fine-grained updates
const userName = atoms['user.name'] // Direct atomic access
```

**Benefits:**
- **Ultra-Fine Granularity**: Component only re-renders for atomic changes
- **Performance Critical Paths**: Optimize specific hot paths
- **Hybrid Approach**: Combine automatic proxy reactivity with manual optimization

## Memory Optimization Techniques

### 6. WeakRef Cleanup (from Modern JavaScript)

**Technique:** Automatic cleanup of unused proxy objects using WeakRef and FinalizationRegistry.

**Implementation Strategy:**
```typescript
// Enhanced proxy cleanup for unused nested objects
class ProxyManager {
  private proxyRefs = new Set<WeakRef<object>>()
  private cleanup = new FinalizationRegistry((proxyId: string) => {
    // Clean up signal subscriptions and WeakMap entries
    this.cleanupProxy(proxyId)
  })
  
  createProxy<T>(target: T): T {
    const proxy = createReactiveProxy(target)
    const ref = new WeakRef(proxy)
    this.proxyRefs.add(ref)
    this.cleanup.register(proxy, generateProxyId())
    return proxy
  }
}
```

**Benefits:**
- **Automatic Memory Management**: Unused proxies get cleaned up
- **Lower Long-term Memory**: Prevents memory leaks in long-running apps
- **Zero Developer Overhead**: Completely automatic

### 7. Snapshot Caching Strategy (from Valtio)

**Technique:** Cache immutable snapshots to avoid repeated serialization.

**Source Analysis:** [`node_modules/valtio/vanilla.js:7-42`](node_modules/valtio/vanilla.js#L7-L42)
```javascript
const snapCache = /* @__PURE__ */ new WeakMap();
const createSnapshot = (target, version) => {
  const cache = snapCache.get(target);
  if ((cache == null ? void 0 : cache[0]) === version) {
    return cache[1]; // Return cached snapshot
  }
  // Create new snapshot...
}
```

**Application to Storable:**
```typescript
// Optional immutable snapshot API for integration scenarios
export function createSnapshot<T>(store: T): DeepReadonly<T> {
  const version = getCurrentVersion(store)
  const cached = snapshotCache.get(store)
  
  if (cached?.version === version) {
    return cached.snapshot
  }
  
  const snapshot = deepFreeze(JSON.parse(JSON.stringify(store)))
  snapshotCache.set(store, { version, snapshot })
  return snapshot
}
```

**Benefits:**
- **Integration Support**: Easy interop with immutable-expecting libraries
- **Debugging Aid**: Frozen state snapshots for debugging
- **Performance**: Cached snapshots avoid repeated serialization

### 8. Selective Reactivity (from MobX)

**Technique:** Choose which properties are reactive vs plain values.

**Application to Storable:**
```typescript
// Enhanced createStore with reactivity control
const [store] = createStore(
  {
    users: [],
    metadata: { created: Date.now(), version: '1.0' }, // Large static data
    cache: new Map() // Non-serializable data
  },
  {
    reactive: ['users'], // Only make users reactive
    static: ['metadata'], // Keep as plain object
    ignore: ['cache'] // Don't proxy at all
  }
)
```

**Benefits:**
- **Memory Efficiency**: Only pay proxy cost for reactive data
- **Performance**: Skip proxy overhead for static data
- **Flexibility**: Mix reactive and non-reactive data as needed

## Developer Experience Enhancements

### 9. DevTools Integration (from Redux DevTools)

**Technique:** Rich debugging interface with time travel and state inspection.

**Implementation Strategy:**
```typescript
// DevTools integration for Storable
if (typeof window !== 'undefined' && window.__STORABLE_DEVTOOLS__) {
  const devTools = window.__STORABLE_DEVTOOLS__.connect({
    name: 'Storable Store'
  })
  
  // Track all update operations
  const originalUpdate = update
  update = (store, operations) => {
    devTools.send({
      type: 'UPDATE',
      payload: operations
    }, getCurrentState(store))
    
    return originalUpdate(store, operations)
  }
}
```

### 10. Type-safe Path Strings (from Lodash-style Libraries)

**Technique:** TypeScript-powered autocompletion for nested property paths.

**Current Enhancement:**
```typescript
// Already well-implemented in Storable's update operators
update(store, {
  $set: {
    'user.profile.address.coordinates.lat': 42
    // ^^^ Fully typed path with autocompletion
  }
})
```

**Potential Extension:**
```typescript
// Enhanced path utilities
export function createPath<T, K extends keyof T>(
  path: PathString<T, K>
): PathAccessor<T, K> {
  // Return typed accessor with get/set methods
}

const userNamePath = createPath<Store, 'user.name'>('user.name')
userNamePath.get(store) // Typed return
userNamePath.set(store, 'John') // Type-safe assignment
```

## Implementation Prioritization

### High Impact, Low Complexity
1. **Lazy Proxy Creation** - Significant performance win with moderate implementation complexity
2. **WeakRef Cleanup** - Automatic memory management with minimal API changes
3. **DevTools Integration** - Major DX improvement, separate package

### Medium Impact, Medium Complexity  
4. **Computed Properties** - Automatic memoization for derived state
5. **Snapshot Caching** - Better integration and debugging capabilities
6. **Selective Reactivity** - Memory optimization for mixed data types

### High Impact, High Complexity
7. **Atomic Granularity** - Optional ultra-fine-grained optimization
8. **Structural Sharing** - Complex but potentially significant memory benefits

### Low Priority
9. **Manual Batching API** - Nice-to-have, current automatic batching is sufficient
10. **Enhanced Path Utilities** - Already well-implemented

## Performance Impact Analysis

**Estimated Performance Gains:**

| Technique | Creation Speed | Update Speed | Memory Usage | Complexity |
|-----------|----------------|--------------|--------------|------------|
| **Lazy Proxying** | +300-500% | No change | -50-70% | Medium |
| **Computed Properties** | No change | Variable | +10-20% | Medium |
| **WeakRef Cleanup** | No change | No change | -10-30% | Low |
| **Selective Reactivity** | +100-200% | +50-100% | -20-40% | High |
| **DevTools** | No change | -10% | +5% | Medium |

## Conclusion

The most impactful optimizations for Storable would be:

1. **Lazy Proxy Creation** - Addresses the main performance bottleneck during initialization
2. **WeakRef Cleanup** - Provides automatic memory management for long-running applications  
3. **Computed Properties** - Fills a common need for derived state without manual optimization
4. **DevTools Integration** - Significantly improves debugging and developer experience

These techniques maintain Storable's core philosophy of automatic optimization while providing additional performance headroom and developer capabilities. The lazy proxying alone could make Storable competitive with Zustand's creation performance while maintaining its automatic reactivity advantages.