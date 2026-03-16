# Failed Approach: Creating Effects Inside a Running Effect

**Date:** March 2026
**Approach:** Watch the data signal with an outer effect, rebuild all rows (including per-row effects) when data changes
**Result:** 5x slower than creating effects outside reactive context
**Key Lesson:** Creating alien-signals effects inside a running effect triggers expensive reactive graph bookkeeping. Build DOM and subscribe signals outside the reactive transaction.

## The Pattern

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

## Benchmark Evidence

From gap-analysis.bench.tsx:
- Pure DOM + alien-signals (effects created outside): **2.5ms**
- Pure DOM + alien-signals + supergrain store (effects outside): **5.1ms**
- DirectDomApp (effects inside outer effect): **25.2ms**

The 5x overhead is entirely from nested effect creation.

## Why It's Slow

When `effect()` is called inside a running effect, alien-signals must:
1. Track the new effect as potentially dependent on the outer effect's dependencies
2. Update the reactive dependency graph
3. Handle cleanup scheduling for the inner effects when the outer re-runs

This bookkeeping multiplied by 2000 effects (2 per row × 1000 rows) adds ~20ms.

## How to Avoid

Build DOM and create signal subscriptions synchronously, not inside a data-watching effect. Use the data-watching effect only for detecting WHEN to rebuild, then exit the reactive context before doing the work.
