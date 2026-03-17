# FAILED: React Performance Optimization Attempts (Bypassing Reconciliation)

> **STATUS: ALL FAILED.** Every attempt to bypass React's reconciliation performed worse than the original Supergrain + `<For>` implementation (666ms for 10K rows). Individual subscriptions scaled terribly (1094-1274ms). Even the "official" `useSyncExternalStore` was 74% slower. React Context was the only approach that came close but still lost by 15%.

**Date:** January 2025

## Goal

Achieve "theoretical maximum" React performance by subscribing individual components directly to store changes, bypassing React's reconciliation.

## Baseline

Supergrain + `<For>` component:
- 1K rows: ~64ms
- 10K rows: ~679ms
- Updates: ~30ms

## Results Summary

| Implementation | 10K rows | vs Supergrain | Verdict |
|----------------|----------|---------------|---------|
| **Supergrain + For** | **666ms** | **baseline** | **Winner** |
| React Context | 765ms | 15% slower | Best alternative |
| Minimal For (no Supergrain) | 787ms | 18% slower | Library "overhead" is optimization |
| Direct Subscriptions | 1094ms | 64% slower | Doesn't scale |
| Direct Subscriptions (no startTransition) | 1274ms | 91% slower | Even worse |
| useSyncExternalStore | 1161ms | 74% slower | Wrong tool |

## What Was Tried

### 1. Direct Subscription with startTransition

Each Row subscribes to its specific item via custom store. Updates wrapped in `startTransition`.

```typescript
const Row = memo(({ itemId }) => {
  const [item, setItem] = useState(() => store.getItem(itemId))
  useEffect(() => store.subscribeToItem(itemId, setItem), [itemId])
})
```

**Result:** 10K rows 61% slower. 10,000 individual subscriptions + useState calls + useEffect cleanups > 1 shared reconciliation pass.

### 2. Removing startTransition

Hypothesis: `startTransition` adds overhead. Try synchronous updates.

**Result:** 16% slower than approach 1. Blocking the main thread without React's scheduling made it worse.

### 3. useSyncExternalStore

React 18's official external store hook.

```typescript
const Row = memo(({ itemId }) => {
  const item = useSyncExternalStore(
    (cb) => store.subscribeItem(itemId, cb),
    () => store.getItemSnapshot(itemId)
  )
})
```

**Result:** 71% slower. Still 10,000 individual subscriptions. `useSyncExternalStore` adds more overhead than plain `useState`.

### 4. React Context

Shared state via Context, split into data + selection contexts.

**Result:** 13% slower for 10K but surprisingly competitive. Context is built into React's reconciliation and optimized for shared state.

### 5. Minimal For Component (no Supergrain)

Stripped out Supergrain, used plain JS store with same `<For>` pattern.

**Result:** 16% slower. Supergrain's proxy system includes optimizations that naive implementations lack.

## Why Individual Subscriptions Don't Scale

**The math:**
- Shared state: 1 update → React diffs N components → O(N) with small constant
- Individual subscriptions: N subscriptions + N useState + N useEffect cleanups → O(N) with large constant

**Memory overhead for 10K rows:**
- 10,000 `useState` hooks
- 10,000 `useEffect` cleanup functions
- 10,000 subscription entries in Maps/Sets
- 10,000 individual fiber reconciliations (no batching benefit)

## Validation Methodology

Initial "optimized" results showed suspiciously fast times (25ms for 10K rows). Row count validation revealed they weren't rendering anything:

```typescript
function validateRowCount(container, expected, testName) {
  const rows = container.querySelectorAll('tbody tr')
  if (rows.length !== expected) {
    throw new Error(`VALIDATION FAILED: ${testName} expected ${expected} rows but found ${rows.length}`)
  }
}
```

This caught timing issues, race conditions, stale refs, and incorrect subscription cleanup across multiple approaches.

## Key Learnings

1. **React's reconciliation is optimized for shared state at scale.** Don't fight it.
2. **Individual subscriptions have per-item overhead that compounds.** At 10K items, the overhead dominates.
3. **Library "overhead" can be net-positive.** Removing Supergrain made things slower, not faster.
4. **`useSyncExternalStore` is for global app state, not per-item subscriptions.**
5. **Always validate rendering actually happened.** Fake fast numbers are easy to produce.
