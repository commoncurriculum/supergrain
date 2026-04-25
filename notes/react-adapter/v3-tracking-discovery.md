# React Adapter v3: Tracking Discovery

> **Status:** Historical. Superseded by v4/v5. Documents the fundamental limitation discovered with alien-signals' `effect()` API in React.
>
> **Key discovery:** alien-signals requires signal/store access INSIDE the effect callback to establish dependencies. Since React components access stores during render (outside any effect callback), a different approach was needed.

## The Core Problem

### How alien-signals Works

1. When an effect runs its callback, it sets itself as current subscriber
2. Any signal/store access during the callback creates a dependency
3. After the callback completes, the previous subscriber is restored

### Why This Breaks with React

```typescript
function useGranary(store) {
  const effect = createEffect(() => {
    // Empty callback -- no store access here
  });
  setCurrentSub(effect); // Set for entire render

  // Component accesses store HERE (outside effect callback)
  // Dependencies NOT established because we're outside the effect callback
  return store;
}
```

The effect has an empty callback, so it never establishes dependencies.

## Failed Attempts

1. **Setting global subscriber during render** -- Conflicts with nested components
2. **`finish()` to restore context** -- Timing issues with React lifecycle
3. **Re-running effect with tracked properties** -- Too complex, inefficient
4. **Manual dependency linking** -- alien-signals doesn't expose needed APIs

## Solution Direction

The discovery led to the proxy-based approach (v4/v5): wrap each property access to temporarily set the correct effect as current subscriber, making the access effectively happen "inside" the tracking context.

This is documented fully in [v4-nested-components.md](v4-nested-components.md) and [useTracked.md](useTracked.md).
