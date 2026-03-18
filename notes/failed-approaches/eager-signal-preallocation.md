# FAILED: Eager Signal Pre-allocation at createStore Time

> **Status:** FAILED — Abandoned
> **Date:** March 2026
> **TL;DR:** Pre-allocating signals for every property at `createStore()` time costs O(total properties) upfront, wastes work for unread properties, and breaks when sub-trees are replaced from the wire. Lazy signal creation is strictly better.

## Goal

Eliminate lazy signal creation overhead by walking initial data recursively at `createStore()` time and pre-creating signals for every property.

## What Was Tried

```typescript
function initSignals(target: object, visited?: Set<object>): void {
  if (!isWrappable(target) || Object.isFrozen(target)) return;
  const nodes = getNodes(target);
  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      getNode(nodes, i, target[i]);
      if (isWrappable(target[i])) initSignals(target[i], visited);
    }
    getNode(nodes, "length", target.length);
  } else {
    for (const key of Object.keys(target)) {
      getNode(nodes, key, target[key]);
      if (isWrappable(value)) initSignals(value, visited);
    }
  }
}
```

Called in `createStore()` and `setProperty()` for new wrappable values.

## Why It Failed

1. **Sub-tree replacement breaks it:** Documents receive updates from the wire. `$set` replaces entire sub-trees. Pre-allocated signals on the old sub-tree are wasted, and new sub-tree data has no signals — they must be created lazily anyway.

2. **Large arrays are expensive:** Pre-allocating signals for 10,000 array elements at creation time is costly and pointless if only a few are ever read.

3. **setProperty overhead:** Calling `initSignals` inside `setProperty` for every new wrappable value added O(properties) work to every write.

4. **Proxy invariant violations:** `Object.defineProperty` for $NODE with `configurable: false` (the default) caused proxy invariant errors when the proxy handler returned different values.

## What Works Instead

Lazy signal creation (the default). The proxy creates signals on first read. `createView` uses prototype getters to ensure signals exist for the properties it needs — O(properties of this view), not O(entire document).

## Key Learnings

- Do not pay upfront costs for data that may never be read.
- Any pre-allocation strategy breaks in the presence of sub-tree replacement (common in document sync scenarios).
- `initSignals` was removed from the codebase after `readSignal` was removed. `createView` handles its own signal creation for the properties it needs.
