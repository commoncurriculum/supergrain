# React Adapter v4: Nested Component Problem Statement

> **Status:** Historical. The problem described here was solved in v5. This doc served as the task specification for fixing nested component tracking.
>
> **Problem:** When parent and child components both use `useStore()`, their tracking contexts interfere due to React's render order.

## What Was Working (v3)

- Basic store reactivity with `useStore()` and `useTracked()`
- Fine-grained updates
- Multiple stores
- Proper cleanup on unmount

## The Nested Component Bug

React renders depth-first:

1. Parent calls `useStore()`, sets its effect as current subscriber
2. Parent renders `<Child />`
3. Child calls `useStore()`, overwrites parent's subscriber
4. Child renders
5. Parent continues with child's subscriber still active
6. Parent tracks wrong dependencies or loses tracking

### Failing Test Case

```typescript
it('should handle nested components with proper isolation', async () => {
  const [store, update] = createStore({ parent: 1, child: 10 })

  function Child() {
    useStore()
    return <span>{store.child}</span>
  }

  function Parent() {
    useStore()
    return <div><span>{store.parent}</span><Child /></div>
  }

  // After updating child property, only Child should re-render
})
```

## Proposed Solutions (at the time)

1. **Immediate context restoration** -- Didn't work (need subscriber during render)
2. **Proxy-based isolation** -- This was the winner (became v5)
3. **Stack-based subscriber management** -- Too complex for concurrent mode
4. **React Context** -- Added overhead without solving timing issue

## Requirements

1. Maintain fine-grained reactivity
2. Handle arbitrary nesting depth
3. Don't break existing tests
4. Minimal performance overhead
5. No babel transform or wrapper components required

## Resolution

Solved by the proxy-based approach in [v5-final.md](v5-final.md) and shipped as `useTracked`.
