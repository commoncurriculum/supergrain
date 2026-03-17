# FAILED: Context Switching Optimization for React Hooks

> **STATUS: FAILED.** Race conditions in React's render cycle made per-render context switching unreliable. Multiple components interfered with each other's context, breaking dependency tracking in nested component trees.

## Goal

Reduce context switches from N×3 (per property access) to 2 per render (once at start, once at end) in Supergrain's React integration.

## What Was Tried

**Original (working):** Set/restore subscriber context on every property access via Proxy `get` trap:

```typescript
const proxy = new Proxy(store, {
  get(obj, prop, receiver) {
    const prevSub = getCurrentSub()     // Context switch #1
    setCurrentSub(effectNode)           // Context switch #2
    try {
      const value = Reflect.get(obj, prop, receiver)
      return createProxy(value)
    } finally {
      setCurrentSub(prevSub)           // Context switch #3
    }
  }
})
```

**Attempted optimization:** Set context once before render, restore in `useLayoutEffect`:

```typescript
export function useOptimizedTrackedStore<T extends object>(store: T): T {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const stateRef = useRef<{ cleanup: (() => void) | null; effectNode: any; prevSub: any } | null>(null)

  if (!stateRef.current) {
    let effectNode: any = null
    let isFirstRun = true
    const prevSub = getCurrentSub()
    const cleanup = effect(() => {
      if (isFirstRun) { effectNode = getCurrentSub(); isFirstRun = false; return }
      forceUpdate()
    })
    stateRef.current = { cleanup, effectNode, prevSub }
  }

  setCurrentSub(stateRef.current.effectNode)  // Context switch #1

  useIsomorphicLayoutEffect(() => {
    setCurrentSub(stateRef.current.prevSub)   // Context switch #2
  })

  return store
}
```

## Why It Failed

1. **Context timing:** `useLayoutEffect` restored context before all property accesses completed, leaving some dependencies untracked.
2. **Multi-component interference:** When multiple components used the same store, their context switches collided during React's render phase.
3. **Parent-child ordering:** Parent sets context → child renders and accesses properties → parent's `useLayoutEffect` fires → child's dependencies lost.
4. **Fabricated benchmarks:** Performance claims of 7.5x-15x improvement were invented, not measured.

## Test Results

- Basic functionality: some tests passed
- Nested components: failed to re-render when dependencies changed
- Multiple stores: inconsistent behavior

```typescript
// This should re-render when child property changes, but didn't:
function Child() {
  const state = useOptimizedTrackedStore(store)
  return <span>{state.child}</span>  // Didn't update when state.child changed
}
```

## Key Learnings

- Per-property context switching exists for correctness, not laziness. It guarantees every access is tracked regardless of render timing, component nesting, or React scheduling.
- Performance optimizations that break correctness are worthless.
- Always run existing tests before claiming improvements.

## Files Created (Now Deleted)

- `packages/react/src/use-store-optimized.ts`
- `packages/react/tests/optimized-performance.test.tsx`
- `packages/react/tests/use-store-optimized.test.tsx`
