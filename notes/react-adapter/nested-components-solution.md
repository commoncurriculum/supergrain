# Nested Component Tracking Solution

## Problem Statement

When parent and child components both use `useStore()` in the original implementation, their tracking contexts interfered with each other due to React's render order:

1. Parent calls `useStore()`, sets its effect as current subscriber
2. Parent starts rendering its JSX, including `<Child />`
3. Child calls `useStore()`, sets ITS effect as current subscriber (overwriting parent's)
4. Child renders with its subscriber active
5. Parent continues rendering with CHILD's subscriber still active
6. `useLayoutEffect` runs to restore subscribers, but timing is wrong

This caused the parent component to potentially track the wrong dependencies or not track at all.

## Solution: Proxy-based Property Access Isolation

The solution uses a proxy that wraps the store and temporarily activates the correct effect during each property access. This ensures that each component's dependencies are tracked independently.

### Implementation

```typescript
export function useTrackedStore<T extends object>(store: T): T {
  // Force re-render when dependencies change
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // Store our effect state and proxy
  const stateRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    proxy: T | null
  }>()

  // Initialize on first render
  if (!stateRef.current) {
    let effectNode: any = null
    let isFirstRun = true

    // Create an effect that will be notified when dependencies change
    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }
      forceUpdate()
    })

    // Create a proxy that ensures our effect is current during property access
    const proxy = new Proxy(store, {
      get(target, prop, receiver) {
        // Save the current subscriber (might be another component's effect)
        const prevSub = getCurrentSub()

        // Set our effect as current for this property access
        setCurrentSub(effectNode)

        try {
          // Access the property (this will establish the dependency)
          return Reflect.get(target, prop, receiver)
        } finally {
          // Restore the previous subscriber
          setCurrentSub(prevSub)
        }
      },
      // ... other proxy traps for completeness
    }) as T

    stateRef.current = { cleanup, effectNode, proxy }
  }

  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      if (state.cleanup) {
        state.cleanup()
        state.cleanup = null
      }
    }
  }, [])

  return stateRef.current.proxy!
}
```

## Key Insights

### 1. Property-Level Isolation
The proxy intercepts every property access and temporarily sets the correct subscriber. This happens at the exact moment the property is accessed, ensuring perfect isolation.

### 2. No Need for React Context
While React Context was considered, the proxy approach is simpler and more performant since it doesn't require additional React components or context providers.

### 3. Leverages Existing Infrastructure
The solution works perfectly with storable's existing proxy-based tracking system. We're not duplicating tracking logic - we're just ensuring the right effect is active at the right time.

## Usage

```tsx
// Simple usage - call useStore() before accessing the store
function Counter() {
  useStore()
  return <div>{store.count}</div>
}

// Preferred usage - returns a proxy that handles isolation automatically
function Counter() {
  const state = useTrackedStore(store)
  return <div>{state.count}</div>
}
```

## Testing

The solution is verified with comprehensive tests including:

- Basic reactivity
- Fine-grained updates (only components accessing changed properties re-render)
- Nested components with proper isolation
- Deeply nested component trees
- Sibling components with independent tracking
- Multiple stores
- Conditional rendering
- Proper cleanup on unmount

All tests pass, confirming that the nested component tracking issue is resolved.

## Alternative Approaches Considered

### 1. Immediate Context Restoration
Restore the previous subscriber immediately after setting the current one. This didn't work because we need the subscriber active during the entire render phase.

### 2. Stack-based Subscriber Management
Maintain a global stack of subscribers. This approach was more complex and had timing issues with React's render cycle.

### 3. React Context for Isolation
Use React Context to pass subscribers between components. This added complexity and didn't solve the fundamental timing issue.

### 4. Multiple Proxy Layers
Create additional proxy layers for tracking. This was unnecessary since storable's proxy already handles tracking perfectly.

## Performance Considerations

The proxy approach has minimal overhead:
- One proxy creation per component (cached across renders)
- Quick subscriber swap during property access
- No additional React components or context providers
- No impact on components not using the hook

## Conclusion

The proxy-based solution elegantly solves the nested component tracking problem by ensuring each component's effect is active only during its own property accesses. This maintains perfect isolation between parent and child components while preserving fine-grained reactivity.
