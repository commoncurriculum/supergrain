# Task: Fix Nested Component Tracking in React Adapter

## Context

We've successfully implemented a React adapter for the `@storable` library that enables automatic reactivity. The solution uses alien-signals' effect system and leverages storable's existing proxy for dependency tracking.

### What's Working
- Basic store reactivity with `useStore()` and `useTrackedStore()` hooks
- Fine-grained updates (only components that access changed properties re-render)
- Multiple stores support
- Proper cleanup on unmount
- Test suite with utilities for flushing microtasks

### The Problem with Nested Components

When parent and child components both use `useStore()`, their tracking contexts can interfere with each other due to React's render order:

1. Parent calls `useStore()`, sets its effect as current subscriber
2. Parent starts rendering its JSX, including `<Child />`
3. Child calls `useStore()`, sets ITS effect as current subscriber (overwriting parent's)
4. Child renders with its subscriber active
5. Parent continues rendering with CHILD's subscriber still active
6. `useLayoutEffect` runs to restore subscribers, but timing is wrong

This causes the parent component to potentially track the wrong dependencies or not track at all.

## Current Implementation Location

- Main hook: `packages/react/src/use-store-simple.ts`
- Alternative approaches: `packages/react/src/use-reactive.tsx` and `use-reactive-v2.tsx`
- Tests: `packages/react/tests/use-store-simple.test.tsx`

## Failing Test Case

In `packages/react/tests/use-store-simple.test.tsx`:

```typescript
it('should handle nested components with proper isolation', async () => {
  const [store, update] = createStore({ parent: 1, child: 10 })
  let parentRenders = 0
  let childRenders = 0

  function Child() {
    useStore()
    childRenders++
    return <span data-testid="child">{store.child}</span>
  }

  function Parent() {
    useStore()
    parentRenders++
    return (
      <div>
        <span data-testid="parent">{store.parent}</span>
        <Child />
      </div>
    )
  }

  // After updating child property, only Child should re-render
  // but currently Parent might also re-render or tracking gets mixed up
})
```

## Potential Solutions to Explore

### Solution 1: Immediate Context Restoration
Instead of using `useLayoutEffect` to restore the previous subscriber, do it immediately after setting the current subscriber, but keep a way to re-activate during property access.

### Solution 2: Proxy-based Isolation
Return a proxy from `useStore()` that temporarily sets the correct subscriber during each property access:

```typescript
function useStore() {
  // ... create effect ...

  return new Proxy(store, {
    get(target, prop) {
      const prevSub = setCurrentSub(ourEffect)
      try {
        return target[prop]
      } finally {
        setCurrentSub(prevSub)
      }
    }
  })
}
```

### Solution 3: Stack-based Subscriber Management
Maintain a stack of subscribers instead of simple prev/current:

```typescript
const subscriberStack = []

function pushSubscriber(sub) {
  subscriberStack.push(getCurrentSub())
  setCurrentSub(sub)
}

function popSubscriber() {
  setCurrentSub(subscriberStack.pop())
}
```

### Solution 4: React Context for Isolation
Use React Context to isolate tracking contexts between component trees.

## Requirements for the Solution

1. **Must maintain fine-grained reactivity**: Only components that access changed properties should re-render
2. **Must handle arbitrary nesting depth**: Parent > Child > GrandChild should all work
3. **Must not break existing tests**: All current passing tests should continue to pass
4. **Should be performant**: Minimal overhead for tracking
5. **Should work without configuration**: No babel transform or wrapper components required

## Testing the Fix

Run the test suite:
```bash
cd packages/react && npm test use-store-simple.test.tsx
```

The solution is correct when all tests pass, especially the nested components test.

## Key Insight from Previous Investigation

The storable proxy already does all the dependency tracking we need - it checks `getCurrentSub()` when properties are accessed and establishes dependencies if there's an active effect. We don't need another proxy layer for tracking, we just need to ensure the RIGHT effect is current when each component accesses the store.

## Files You'll Need to Modify

1. `packages/react/src/use-store-simple.ts` - The main implementation
2. Possibly create a new file with the fixed implementation
3. Update tests if needed to verify the fix works

## Success Criteria

- All tests in `use-store-simple.test.tsx` pass
- Nested components properly isolate their tracking contexts
- Parent components don't re-render when only child-tracked properties change
- Child components don't interfere with parent tracking

Good luck! The foundation is solid, we just need to solve this one isolation issue for nested components.
