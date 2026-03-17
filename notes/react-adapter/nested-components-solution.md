# Nested Component Tracking Solution

> **Status:** Shipped as `useTracked`. This is a focused summary; see [v5-final.md](v5-final.md) for the complete solution with performance data and comparison to Preact.

## Problem

React renders depth-first. When parent and child both use the store:

1. Parent sets its effect as current subscriber
2. Parent renders `<Child />`
3. Child sets ITS effect as current subscriber (overwrites parent's)
4. Child renders, parent continues with wrong subscriber active

## Solution: Per-Access Subscriber Swapping

Each component gets a proxy that swaps `getCurrentSub()` at the exact moment of property access:

```typescript
const proxy = new Proxy(store, {
  get(target, prop, receiver) {
    const prevSub = getCurrentSub()
    setCurrentSub(effectNode)  // This component's effect
    try {
      return Reflect.get(target, prop, receiver)
    } finally {
      setCurrentSub(prevSub)   // Restore immediately
    }
  },
})
```

**Why it works:** The subscriber swap is microsecond-precise -- it happens at the exact moment of property access, not for the entire render. No component can overwrite another's tracking context.

## Alternatives That Failed

1. **Immediate context restoration** -- Subscriber needed during entire render
2. **Stack-based management** -- Concurrent mode breaks stack assumptions
3. **React Context** -- Added complexity, didn't solve timing
4. **Multiple proxy layers** -- Unnecessary since Supergrain's proxy handles tracking

## Full implementation and test coverage documented in [v5-final.md](v5-final.md).
