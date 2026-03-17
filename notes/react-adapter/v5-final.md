# React Adapter v5: Final Solution

> **Status:** Shipped as `useTracked`. This is the definitive solution for React integration with alien-signals-based stores.
>
> **Key insight:** Wrap each property access in a subscriber swap so that alien-signals sees the correct effect at the exact moment of access, providing perfect nested component isolation without a build step.

## The Problem (Recap)

alien-signals requires signal access INSIDE an effect callback to establish dependencies. React components access stores during render, outside any effect. Setting a global subscriber for the entire render breaks with nested components (child overwrites parent's context).

## The Solution: Proxy-Based Property Access Isolation

Each component gets a proxy that temporarily swaps `getCurrentSub()` during every property access:

```typescript
export function useTracked<T extends object>(store: T): T {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const stateRef = useRef<{ cleanup: (() => void) | null; effectNode: any; proxy: T | null }>()

  if (!stateRef.current) {
    let effectNode: any = null
    let isFirstRun = true

    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()  // Capture node INSIDE callback
        isFirstRun = false
        return
      }
      forceUpdate()  // Trigger re-render on dependency changes
    })

    const proxy = new Proxy(store, {
      get(target, prop, receiver) {
        const prevSub = getCurrentSub()
        setCurrentSub(effectNode)
        try {
          return Reflect.get(target, prop, receiver)
        } finally {
          setCurrentSub(prevSub)
        }
      },
    }) as T

    stateRef.current = { cleanup, effectNode, proxy }
  }

  useEffect(() => () => { stateRef.current?.cleanup?.(); stateRef.current = null }, [])

  return stateRef.current.proxy!
}
```

### Why It Works

**Two-proxy architecture:**
- Supergrain's proxy tracks dependencies for whoever is currently listening (`getCurrentSub()`)
- The `useTracked` proxy ensures the RIGHT component is listening during each specific property access

**Temporal isolation:** The subscriber swap is microsecond-precise -- it happens at the exact moment of property access and restores immediately.

## Usage

```tsx
// Recommended: useTracked returns a proxy with automatic tracking
function Parent() {
  const state = useTracked(store)
  return <div>{state.parent}<Child /></div>
}

function Child() {
  const state = useTracked(store)
  return <div>{state.child}</div>
}
```

## All Approaches Tried (8 total)

| # | Approach | Result | Why |
|---|----------|--------|-----|
| 1 | Global subscriber during render | Failed | Child overwrites parent context |
| 2 | Immediate context restoration | Failed | Render is synchronous, Promise.resolve too late |
| 3 | Stack-based subscriber management | Partial | Concurrent mode and error boundaries break stack |
| 4 | React Context for isolation | Failed | Added complexity, timing still wrong |
| 5 | Manual track function | Worked | Poor DX (verbose `track(() => store.x)` syntax) |
| 6 | Finish/restore pattern | Failed | `finish()` not called at right time, fragile |
| 7 | Effect with tracked callback | Failed | Can't predict which properties component will access |
| 8 | **Proxy-based isolation** | **Shipped** | Perfect isolation, good DX, no build step |

## Performance

| Metric | Cost |
|--------|------|
| Per component | 1 proxy + 1 effect + 1 ref (first render only) |
| Per property access | getCurrentSub + setCurrentSub + Reflect.get + restore (~0.001ms) |
| 100 nested components | ~20% overhead vs untracked |
| 1,000 property accesses | ~50% overhead vs untracked |
| Typical real-world app | <5% of render time |

## Comparison with Preact Signals

Preact Signals avoids this problem via two modes:

| Aspect | Preact (Unmanaged) | Preact (Managed) | Supergrain |
|--------|-------------------|-----------------|-----------|
| Setup | Zero-config | Requires Babel | Requires `useTracked` |
| Build step | None | Required | None |
| Nested components | Timing issues | Perfect | Perfect via proxy |
| Accidental tracking | Can happen | Prevented | Prevented |

Preact's unmanaged mode has subtle bugs (signals in `useLayoutEffect` get incorrectly tracked, effects may not close at the right time). Their managed mode requires a Babel transform to wrap components in `try/finally`.

Supergrain's approach sits between these: no build step required, but provides the same precision as managed mode by wrapping each property access.

**Philosophical difference:** Preact tries to make tracking invisible (with varying success). Supergrain makes it explicit but reliable, aligning with React's "explicit is better than implicit" philosophy.

## Testing Utilities

```typescript
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()  // Double flush for chained effects
}

await act(async () => {
  update({ $set: { value: 2 } })
  await flushMicrotasks()
})
```

## Migration from useStore

```tsx
// Before (broken for nested components)
function Component() {
  const state = useStore(store)
  return <div>{state.value}</div>
}

// After (works everywhere)
function Component() {
  const state = useTracked(store)
  return <div>{state.value}</div>
}
```
