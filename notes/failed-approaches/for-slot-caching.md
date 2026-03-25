# FAILED: Slot Caching in For Component (Parent Path)

> **Status:** FAILED — Do Not Implement
> **Date:** March 2026
> **TL;DR:** Caching React elements returned by `children()` in the For component's parent path provides no performance benefit. Map-based caching adds overhead that offsets savings. Array-identity caching is incompatible with the O(1) swap effect. Both approaches break inline children.

## Context

After removing CachedForItem (the per-item tracked wrapper in For's parent path), the For component calls `children(each[i], i)` for ALL items on every re-render — including existing items on append. With CachedForItem, existing items were memo'd by tracked() and only new items called `children()`.

This creates a measurable append regression: ~+4ms script time on append 1k (33.2ms → 37.1ms median, 5 runs).

## Goal

Skip `children()` calls for unchanged items by caching the returned React elements.

## What Was Tried

### Approach 1: Map-based cache (keyed by item id)

```tsx
const prevCache = elementCacheRef.current;
const newCache = new Map<React.Key, React.ReactNode>();
for (let i = 0; i < raw.length; i++) {
  const key = rawItem.id;
  const cached = prevCache.get(key);
  slots[i] = cached ?? children(each[i], i);
  newCache.set(key, slots[i]);
}
elementCacheRef.current = newCache;
```

**Results (median script, 5 runs):**

| Operation      | No cache | Map cache |
| -------------- | -------- | --------- |
| append 1k      | 37.1ms   | 39.5ms    |
| partial update | 14.5ms   | 16.8ms    |
| create 1k      | 20.9ms   | 21.1ms    |

Map cache was **net-negative**. The Map allocation, .get()/.set() calls, and key extraction cost more per-item than just calling `children()`.

### Approach 2: Array-identity cache (indexed by position)

```tsx
const prevSlots = prevSlotsRef.current;
const prevRaw = prevRawRef.current;
for (let i = 0; i < raw.length; i++) {
  if (i < prevRaw.length && raw[i] === prevRaw[i]) {
    slots[i] = prevSlots[i];
  } else {
    slots[i] = children(each[i], i);
  }
}
```

**Correctness failures:**

1. **Breaks after O(1) swap.** The swap effect moves DOM nodes without updating the React fiber tree. If For later re-renders and returns a cached element reference, React sees "same element, skip diff" — so the fiber/DOM mismatch from the swap is never corrected. Added `prevSlotsRef.current = []` in the swap effect to invalidate, but this means the cache is cold whenever it matters most (swap then structural change).

2. **Breaks inline children with external state.** When the `children` callback captures external state (e.g., `store.selected` from an outer closure), cached elements contain stale closure values. Added `children !== prevChildrenRef.current` invalidation, but inline arrow functions are always new references — so the cache never hits for inline children.

Even after both fixes, the benchmark showed no improvement over the uncached version.

## Why It Failed

### The per-item check costs as much as the per-item creation

The savings from skipping `children()` are:

- 1 proxy array read (`each[i]`)
- 1 function call (`children(item, i)`)
- 1 `React.createElement(Row, {item, key})` inside children
- 1 `item.id` proxy read for the key

The cost of the cache check is:

- 1 `raw[i]` read
- 1 `prevRaw[i]` read
- 1 identity comparison
- 1 `prevSlots[i]` read (on hit)
- Map variant adds: .get(), .set(), key extraction

These are comparable. For 1000 items, the difference is ~0-2ms — within noise.

### The O(1) swap creates fundamental incompatibility

The swap effect moves DOM without updating fibers. Any element caching must be invalidated after a swap, because returning the same element reference tells React "nothing changed here" — but the DOM DID change. This means the cache is cold in the swap-then-structural-change sequence, which is a common benchmark operation.

## Key Lesson

Don't try to replicate React's memoization manually in a render loop. The per-item check cost is comparable to the per-item creation cost. Map lookups, identity comparisons, and cache invalidation logic add overhead that offsets the savings from skipping `children()`.

CachedForItem's memo behavior came from being a React component boundary (tracked/memo), not from manual caching. But restoring CachedForItem is net-negative: it fixes the +4ms append regression but adds +5ms to create and +8ms to remove (measured, 5 runs each). The append regression is also a script-only cost — total time (script + paint) is flat because fewer objects means less GC pressure during paint.

The correct call is to not have CachedForItem.
