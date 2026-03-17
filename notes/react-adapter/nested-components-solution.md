# Nested Component Tracking Solution

> **Status:** Shipped as `useTracked`. This documents the problem and the proxy-based solution that resolved it.
>
> **Key insight:** Wrap the store in a per-component proxy that swaps `getCurrentSub()` during each property access, ensuring perfect isolation between nested parent/child components.

## Problem

When parent and child components both use the store, React's depth-first render order causes tracking context conflicts:

1. Parent sets its effect as current subscriber
2. Parent renders `<Child />`
3. Child sets ITS effect as current subscriber (overwrites parent's)
4. Child renders
5. Parent continues rendering with child's subscriber still active
6. Parent tracks wrong dependencies or loses tracking entirely

## Solution: Per-Access Subscriber Swapping

```typescript
export function useTracked<T extends object>(store: T): T {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const stateRef = useRef<{ cleanup: (() => void) | null; effectNode: any; proxy: T | null }>()

  if (!stateRef.current) {
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

## Why It Works

1. **Property-level isolation:** The subscriber swap happens at the exact moment of property access, not for the entire render.
2. **No React Context needed:** The proxy approach is simpler and more performant.
3. **Leverages existing infrastructure:** Supergrain's proxy already does dependency tracking; this just ensures the right effect is active.

## Usage

```tsx
function Parent() {
  const state = useTracked(store)
  return <div>{state.parent}<Child /></div>  // Only tracks "parent"
}

function Child() {
  const state = useTracked(store)
  return <div>{state.child}</div>  // Only tracks "child"
}
```

## Alternatives Considered (All Failed or Inferior)

1. **Immediate context restoration** -- Subscriber needed during entire render, not just setup
2. **Stack-based subscriber management** -- Complex, timing issues with concurrent mode
3. **React Context for isolation** -- Added complexity, didn't solve fundamental timing issue
4. **Multiple proxy layers** -- Unnecessary since existing proxy handles tracking

## Performance

- One proxy per component (cached across renders)
- Quick subscriber swap per property access
- No additional React components or context providers
- No impact on components not using the hook

## Test Coverage

Verified with tests for: basic reactivity, fine-grained updates, nested components, deeply nested trees, sibling isolation, multiple stores, conditional rendering, unmount cleanup.
