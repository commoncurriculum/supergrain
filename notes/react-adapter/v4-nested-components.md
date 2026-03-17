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

## Resolution

Solved by proxy-based per-access subscriber swapping in [v5-final.md](v5-final.md), shipped as `useTracked`.
