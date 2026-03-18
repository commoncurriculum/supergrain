# FAILED: React `<For>` Component for Array Iteration

> **Status:** FAILED — Do Not Implement
> **Date:** September 2025
> **TL;DR:** A `<For>` component provides zero performance benefit over `.map()` in React. The proxy system creates new object references on every render, breaking React.memo. React reconciliation is the bottleneck (208x slower than hook-only), not the iteration method.

## Goal

Investigate whether a special `<For>` React component for array iteration could optimize row selection in large tables — specifically, re-rendering only changed rows instead of all rows.

## Key Question

"When selecting a row, do we re-render all elements or just the selected one?"

## Answer

**All elements re-render**, regardless of iteration approach. This is fundamental to how React + proxies interact.

## What Was Tried

### Approaches Benchmarked

1. **Regular `.map()`** — 50/50 rows re-render (2% efficiency)
2. **React.memo** — 50/50 rows re-render (2% efficiency) — broken by proxies
3. **`<For>` component** — 50/50 rows re-render (2% efficiency)
4. **Optimized `<For>` with internal caching** — still renders all due to reconciliation
5. **Signal-aware `<For>`** — complex API, breaks React patterns, proxy problems persist

### Performance Benchmarks (ops/sec)

| Approach      | Performance (ops/sec) | Re-renders | Efficiency |
| ------------- | --------------------: | ---------- | ---------- |
| Regular Map   |                318.73 | All rows   | 2%         |
| React.memo    |                273.84 | All rows   | 2%         |
| For Component |                278.77 | All rows   | 2%         |
| DOM Rendering |                 34.81 | All rows   | 2%         |

### Scalability Results

- **200 rows**: All 200 re-render (1% efficiency)
- **1000 rows**: All 1000 re-render, ~12ms selection time
- **Performance impact**: Linear with row count

## Why It Failed

### Root Cause: Proxy System Breaks React.memo

`useTracked` creates new proxy objects for array items on each render, producing different object references. This defeats React.memo's shallow comparison.

```tsx
{
  state.data.map((row: RowData) => (
    <MemoizedRow
      key={row.id}
      item={row} // New proxy reference every render — memo always re-renders
      isSelected={row.id === state.selected} // Only changes for 2 rows
      onClick={selectRow} // Stable reference
    />
  ));
}
```

```typescript
// Verification:
Row 1: Original vs Proxied = DIFFERENT
Row 2: Original vs Proxied = DIFFERENT
Row 3: Original vs Proxied = DIFFERENT
```

### React Reconciliation is the Bottleneck

```jsx
<For each={state.comments}>{(comment) => <Comment comment={comment} />}</For>
// React still: calls render, maps all items, creates elements, reconciles entire tree
```

The 208x gap between hook-only (4,564 ops/sec) and full DOM (21 ops/sec) proves DOM/reconciliation is the constraint.

### Fundamental Architecture Mismatch

- **Store signals**: Property-level granular reactivity
- **React components**: Component-tree level reconciliation
- **Result**: Granular reactivity cannot bypass component reconciliation

## Performance Context

### Core Store Performance (not the bottleneck)

- Row selection: 7,968 ops/sec
- Row swapping: 7,825 ops/sec

### React Integration Performance

- Hook-only: 4,564 ops/sec (no DOM overhead)
- Full DOM: 21 ops/sec (208x slower — DOM rendering is the bottleneck)

## What Works Instead

- **Virtualization** (`react-window`) for large lists (10,000+ items)
- **Pagination** for better UX
- **Server-side filtering** for massive datasets
- **Lazy loading** for initial page load

The proxy-based API remains optimal for developer experience (automatic tracking, clean syntax, MongoDB-style updates). Its minor performance cost is justified.

## Key Learnings

1. **Proxy overhead vs DX:** The proxy system trades React.memo compatibility for automatic dependency tracking and a clean API. Worth the trade-off for most applications.
2. **React reconciliation cannot be bypassed** by clever iteration components. React fundamentally processes entire component subtrees.
3. **Measure before optimizing.** The perceived issue ("array iteration might be slow") was wrong. The actual bottleneck is DOM rendering and reconciliation (208x slower).
4. **Optimization priority order:** DOM > Reconciliation > State > Iteration.

## Test Environment

- **Platform**: Chromium via Playwright (real browser)
- **Framework**: React 19.1.1
- **Store**: Supergrain with alien-signals
- **Test sizes**: 50, 100, 200, 1000, 10000 items

## Files Generated During Investigation

- `packages/react/benchmarks/for-component-analysis.bench.tsx`
- `packages/react/tests/render-analysis.test.tsx`
- `packages/react/vitest.bench.config.ts`
- `packages/react/benchmarks/row-operations.bench.tsx`
