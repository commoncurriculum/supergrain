# FAILED: Creating Effects Inside a Running Effect

> **Status:** FAILED — Fixed by restructuring
> **Date:** March 2026
> **TL;DR:** Creating alien-signals effects inside a running effect is 5x slower than creating them outside the reactive context. The reactive graph bookkeeping for 2000 nested effects (2 per row x 1000 rows) adds ~20ms overhead. Build DOM and subscribe signals synchronously, outside any effect.

## Goal

Watch a data signal with an outer effect and rebuild all rows (including per-row effects) when data changes.

## What Was Tried

```typescript
// SLOW: ~25ms for 1000 rows
const dataCleanup = effect(() => {
  const data = storeNodes.data()  // subscribe to data signal
  tbody.textContent = ''
  for (const item of data) {
    const tr = rowTemplate.cloneNode(true)
    // Creating effects INSIDE the running outer effect:
    effect(() => { a1.textContent = itemNodes.label() })      // inner effect 1
    effect(() => { tr.className = storeNodes.selected() ... }) // inner effect 2
    tbody.appendChild(tr)
  }
})
```

## Why It Failed

When `effect()` is called inside a running effect, alien-signals must:

1. Track the new effect as potentially dependent on the outer effect's dependencies
2. Update the reactive dependency graph
3. Handle cleanup scheduling for inner effects when the outer re-runs

This bookkeeping multiplied by 2000 effects (2 per row x 1000 rows) adds ~20ms.

## Benchmark Evidence

From `gap-analysis.bench.tsx`:

| Approach                                                      | Time (1000 rows) |
| ------------------------------------------------------------- | ---------------- |
| Pure DOM + alien-signals (effects outside)                    | 2.5ms            |
| Pure DOM + alien-signals + supergrain store (effects outside) | 5.1ms            |
| DirectDomApp (effects inside outer effect)                    | 25.2ms           |

The 5x overhead is entirely from nested effect creation.

## The Fix

```typescript
// FAST: ~5ms for 1000 rows
const data = buildData(1000)
for (const item of data) {
  const tr = rowTemplate.cloneNode(true)
  // Creating effects OUTSIDE any reactive context:
  effect(() => { a1.textContent = itemNodes.label() })
  effect(() => { tr.className = storeNodes.selected() ... })
  tbody.appendChild(tr)
}
```

## Key Learnings

- Build DOM and create signal subscriptions synchronously, not inside a data-watching effect.
- Use the data-watching effect only to detect WHEN to rebuild, then exit the reactive context before doing the work.
- Nested effect creation overhead is per-effect, so it scales linearly with row count.
