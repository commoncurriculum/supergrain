# React Adapter v2: Initial Design

> **Status:** HISTORICAL -- superseded by v3, v4, and v5. The shipped solution is `useTracked` (see [v5-final.md](v5-final.md)).
>
> **What this doc captured:** Early architecture exploration based on Preact Signals and alien-signals patterns. Many APIs proposed here (selectors, computed hooks, DevTools, SSR) were never built.

## Reference Sources

- [Preact Signals React Runtime](https://raw.githubusercontent.com/preactjs/signals/refs/heads/main/packages/react/runtime/src/index.ts)
- [Alien Signals System](https://raw.githubusercontent.com/stackblitz/alien-signals/refs/heads/master/src/system.ts)
- [Alien Signals Index](https://raw.githubusercontent.com/stackblitz/alien-signals/refs/heads/master/src/index.ts)

## Core Requirements (unchanged through v2-v5)

1. Fine-grained reactivity: only re-render when accessed properties change
2. Batched updates: multiple mutations = single re-render
3. Memory safety: proper cleanup on unmount
4. React Strict Mode and Concurrent Mode compatible

## Key Insight: Preact's Effect Store Pattern

Preact creates an effect that runs during the render phase, not in `useEffect`. The pattern:

1. Maintain a global `currentStore` to track the active effect
2. The effect's callback increments a version counter and notifies React
3. Use `useSyncExternalStore` with a 32-bit integer version for change detection

```typescript
function createEffectStore() {
  let effectInstance: Effect
  let version = 0
  let onChangeNotifyReact: (() => void) | undefined

  let unsubscribe = effect(function (this: Effect) {
    effectInstance = this
  })

  effectInstance._callback = function () {
    version = (version + 1) | 0  // 32-bit int for V8 SMI optimization
    if (onChangeNotifyReact) onChangeNotifyReact()
  }

  return {
    subscribe(onStoreChange) {
      onChangeNotifyReact = onStoreChange
      return () => {
        version = (version + 1) | 0
        onChangeNotifyReact = undefined
        unsubscribe()
      }
    },
    getSnapshot() {
      return version
    },
  }
}
```

The `| 0` coercion keeps version as a V8 SMI (Small Integer) -- faster comparison, less memory, predictable overflow at ~2 billion.

## Dependency Tracking Limitation (the critical discovery)

This was the central blocker that drove v3/v4/v5:

**alien-signals requires signal access INSIDE an effect callback to establish dependencies.** React components access stores during render, which is outside any effect callback.

```typescript
// DOESN'T WORK -- effect has no dependencies
const cleanup = effect(() => {
  // Empty callback
})
setCurrentSub(effectInstance)
const value = store.property  // Outside effect callback -- no tracking!
setCurrentSub(prevSub)

// WORKS -- effect tracks dependencies
const cleanup = effect(() => {
  const value = store.property  // Inside callback -- tracked!
})
```

### Approaches Considered

1. **Modify alien-signals** -- Not feasible (external library)
2. **Preact's `_start()`/`_callback()` pattern** -- Requires deep signals internals access
3. **Babel transform** -- Adds build complexity
4. **Manual property declaration** -- Poor DX
5. **Proxy-based tracking** -- This is what shipped (v5's `useTracked`)

## Implementation Lessons

- The effect tracking dependencies must be active **during** the component render, not in `useEffect`
- When creating an alien-signals effect, it runs immediately -- use a flag to skip the initial run
- Direct property access on reactive stores triggers dependency tracking, but only if the correct subscriber is set
- Don't create effects in the render phase (causes "Cannot update component while rendering")

## What Was Cut From This Design

The original v2 doc proposed Phase 2/3 features that were never built:
- `useStoreSelector`, `useComputed`, `useStoreEffect` hooks
- DevTools integration and dependency graph visualization
- SSR/hydration support
- Redux/MobX migration adapters
- `StoreProvider` and `Observer` components
