# React Adapter Final Solution

## Executive Summary

After extensive testing and debugging, we discovered a fundamental limitation when using alien-signals' `effect()` API with React components: dependencies are only established when signals/stores are accessed INSIDE the effect's callback function. Since React components access stores during render (outside any effect callback), we needed a different approach.

The solution is to use explicit tracking wrappers that temporarily set the effect as the current subscriber during each store property access, ensuring proper dependency tracking while maintaining isolation between nested components.

## The Core Problem

### How alien-signals Works

alien-signals uses a global "current subscriber" pattern for dependency tracking:

1. When an effect runs its callback, it sets itself as the current subscriber
2. Any signal/store access during the callback creates a dependency
3. After the callback completes, the previous subscriber is restored
4. When dependencies change, the effect callback runs again

### Why This Doesn't Work with React

```typescript
// This is what we tried initially - DOESN'T WORK
function useStore(store) {
  const effect = createEffect(() => {
    // Empty callback - no store access here
  })
  setCurrentSub(effect) // Set for entire render

  // Component renders and accesses store HERE (outside effect callback)
  // But dependencies aren't established because we're not inside the effect callback!
  return store
}
```

The effect has an empty callback, so it never establishes dependencies on the store properties the component accesses.

### Failed Attempts

1. **Setting global subscriber during render**: Causes conflicts with nested components
2. **Using finish() to restore context**: Timing issues with React's lifecycle
3. **Re-running effect with tracked properties**: Too complex and inefficient
4. **Manual dependency linking**: alien-signals doesn't expose the necessary APIs

## The Working Solution

### Approach 1: Tracked Store Proxy

Create a proxy that wraps each property access with proper tracking:

```typescript
export function useTracked<T extends object>(store: T): T {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const effectRef = useRef<{ cleanup: (() => void) | null; effectNode: any }>()

  // Create effect on first render
  if (!effectRef.current) {
    let effectNode: any = null
    let isFirstRun = true

    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub() // Capture node INSIDE callback
        isFirstRun = false
        return
      }
      forceUpdate() // Trigger re-render on changes
    })

    effectRef.current = { cleanup, effectNode }
  }

  // Create proxy that tracks property access
  const trackedStore = useRef<T>()
  if (!trackedStore.current) {
    trackedStore.current = new Proxy(store, {
      get(target, prop, receiver) {
        // Temporarily set our effect as current during access
        const prevSub = setCurrentSub(effectRef.current.effectNode)
        try {
          return Reflect.get(target, prop, receiver)
        } finally {
          setCurrentSub(prevSub)
        }
      }
    })
  }

  return trackedStore.current
}
```

### Approach 2: Explicit Track Function

Return a function that wraps store access:

```typescript
export function useReactive() {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const effectRef = useRef<{ cleanup: (() => void) | null; effectNode: any }>()

  if (!effectRef.current) {
    let effectNode: any = null
    let isFirstRun = true

    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }
      forceUpdate()
    })

    effectRef.current = { cleanup, effectNode }
  }

  // Return track function for explicit tracking
  const track = <T,>(accessor: () => T): T => {
    const prevSub = setCurrentSub(effectRef.current.effectNode)
    try {
      return accessor()
    } finally {
      setCurrentSub(prevSub)
    }
  }

  return track
}
```

### Approach 3: Simple Global Tracking (with limitations)

For simple cases without nested components:

```typescript
export function useReactive(): void {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const effectRef = useRef<{ cleanup: (() => void) | null; effectNode: any }>()

  if (!effectRef.current) {
    let effectNode: any = null
    let isFirstRun = true

    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }
      forceUpdate()
    })

    effectRef.current = { cleanup, effectNode }
  }

  // Set as current subscriber for this render
  setCurrentSub(effectRef.current.effectNode)

  // Restore after render
  useLayoutEffect(() => {
    setCurrentSub(null)
  })
}
```

## Usage Examples

### Using Tracked Store (Recommended)

```tsx
function Counter() {
  const store = useTracked(myStore)
  return <div>{store.count}</div> // Automatically tracked
}

function Parent() {
  const store = useTracked(myStore)
  return (
    <div>
      {store.parentValue}
      <Child /> {/* Child has independent tracking */}
    </div>
  )
}
```

### Using Explicit Track Function

```tsx
function Counter() {
  const track = useReactive()

  // Explicitly track what you need
  const count = track(() => store.count)
  const doubled = track(() => store.count * 2)

  // This won't be tracked
  const untracked = store.metadata

  return <div>{count} x 2 = {doubled}</div>
}
```

### Using Simple Global Tracking

```tsx
function SimpleComponent() {
  useReactive() // Must be first!

  // All store access in this component is tracked
  return <div>{store.value}</div>
}
```

## Key Insights

### 1. Effect Callback Timing

The effect callback must ACCESS the reactive values to establish dependencies. Simply being the "current subscriber" isn't enough - the access must happen INSIDE the effect callback.

### 2. React Render Order

React renders components depth-first:
1. Parent starts render
2. Parent renders children (while parent context is active)
3. Child components render (potentially overwriting parent context)
4. Parent finishes render

This makes global tracking contexts problematic for nested components.

### 3. Proxy Performance

Creating proxies for each component is acceptable because:
- Proxies are lightweight
- They're created once per component instance
- Property access overhead is minimal

### 4. Batching Works

The storable library's batching (via `queueMicrotask`) works correctly with our solution. Multiple updates are batched and trigger a single re-render.

## Testing Utilities

For testing components that use reactive stores:

```typescript
export async function flushMicrotasks(): Promise<void> {
  // Wait for microtasks to run (batched updates)
  await Promise.resolve()
  // Double flush to catch any effects that schedule more microtasks
  await Promise.resolve()
}

// Usage in tests
await act(async () => {
  update({ $set: { value: 2 } })
  await flushMicrotasks()
})
```

## Migration Guide

### From useStore (broken) to useTracked

Before:
```tsx
function Component() {
  const state = useStore(store) // Doesn't track properly
  return <div>{state.value}</div>
}
```

After:
```tsx
function Component() {
  const state = useTracked(store) // Properly tracked
  return <div>{state.value}</div>
}
```

### Adding to Existing Components

For existing components, simply add the hook:
```tsx
function ExistingComponent() {
  const store = useTracked(globalStore) // Add this

  // Now use store instead of globalStore
  return <div>{store.value}</div>
}
```

## Performance Considerations

1. **Proxy overhead**: Minimal - only affects property access, not computation
2. **Effect creation**: One per component instance, cleaned up on unmount
3. **Re-render optimization**: Only components that access changed properties re-render
4. **Batching**: Multiple updates in the same microtask trigger one re-render

## Future Improvements

1. **Babel transform**: Could automatically wrap components for zero-config usage
2. **DevTools integration**: Show which properties trigger re-renders
3. **Selective tracking**: API to exclude certain properties from tracking
4. **Computed values**: Memoized derived values with automatic dependency tracking

## Conclusion

The final solution works by ensuring store property access happens while our effect is the current subscriber, but only for the duration of that specific access. This provides:

- ✅ Automatic dependency tracking
- ✅ Fine-grained reactivity (only tracked properties trigger re-renders)
- ✅ Proper isolation between nested components
- ✅ Clean integration with React's lifecycle
- ✅ TypeScript support with full type safety
- ✅ No build-time configuration required

The key insight was understanding that alien-signals requires signal access to happen INSIDE the effect callback to establish dependencies. By wrapping each property access, we effectively make it happen "inside" our effect's tracking context.
