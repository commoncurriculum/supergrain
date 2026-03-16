# Failed Approach: Eager Signal Pre-allocation at createStore Time

**Date:** March 2026
**Approach:** Walk the initial data recursively at `createStore()` time and pre-create signals for every property
**Result:** Unnecessary overhead, doesn't help with sub-tree replacement
**Key Lesson:** Pre-allocation costs O(total properties) upfront and wastes work for properties that are never read. It also breaks when sub-trees are replaced from the wire — new data doesn't have pre-allocated signals.

## What Was Tried

```typescript
function initSignals(target: object, visited?: Set<object>): void {
  if (!isWrappable(target) || Object.isFrozen(target)) return
  const nodes = getNodes(target)
  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      getNode(nodes, i, target[i])
      if (isWrappable(target[i])) initSignals(target[i], visited)
    }
    getNode(nodes, 'length', target.length)
  } else {
    for (const key of Object.keys(target)) {
      getNode(nodes, key, target[key])
      if (isWrappable(value)) initSignals(value, visited)
    }
  }
}
```

Called in `createStore()` and `setProperty()` for new wrappable values.

## Why It Failed

1. **Sub-tree replacement**: Documents receive updates from the wire. `$set` replaces entire sub-trees. Pre-allocated signals on the old sub-tree are wasted. New sub-tree data doesn't have signals.

2. **Large arrays**: Pre-allocating signals for 10,000 array elements at creation time is expensive and unnecessary if only a few are ever read.

3. **setProperty overhead**: Calling `initSignals` inside `setProperty` for every new wrappable value added O(properties) work to every write.

4. **Proxy invariant violations**: `Object.defineProperty` for $NODE with `configurable: false` (the default) caused proxy invariant errors when the proxy handler returned different values.

## What Actually Works

Lazy signal creation (the default) works fine. The proxy or readSignal creates signals on first read. The `createView` prototype getter approach ensures signals exist for known properties when building the view, which is O(properties of this view) — not O(entire document).

## Note

`initSignals` is still in the codebase (called from `createStore`) for the compiled mode's inlined `$NODE` access to work. It should be removed if the compiled `readSignal` approach is deprecated in favor of `createView` + `$$()`.
