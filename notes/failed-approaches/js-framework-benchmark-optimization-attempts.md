# FAILED: js-framework-benchmark React Performance Optimizations

> **STATUS: MOSTLY FAILED.** 12 of 14 optimization attempts performed equal to or worse than baseline. The two minor wins (Context + useMemo at ~1-2% faster) were insignificant. Direct DOM manipulation (Step 13) achieved 27% improvement but abandoned React entirely, making it irrelevant. The original Supergrain + `<For>` component was already optimal.

**Date:** January 2025

## Goal

Optimize the js-framework-benchmark react-hooks implementation beyond Supergrain's existing performance (~773ms total).

## Root Cause of Original Benchmark Slowness

The js-framework-benchmark react-hooks implementation creates new callback references on every render, completely breaking `React.memo`:

```typescript
// Inline callback = new function reference every render = React.memo useless
{data.map(item => (
  <Row onSelect={() => dispatch({ type: 'SELECT', id: item.id })} /> // NEW FUNCTION EVERY RENDER
))}
```

## What Was Tried (14 Steps)

### Steps That Made Things Worse

| Step | Approach                                | Result vs Baseline (857ms) |
| ---- | --------------------------------------- | -------------------------- |
| 2    | `useCallback` without fixing root cause | +2.4% slower (878ms)       |
| 3    | Dispatch prop in Row component          | +17.5% slower (1007ms)     |
| 5    | Removing React.memo                     | +9.9% slower (942ms)       |
| 6    | Custom hook with memoized handlers      | +19.9% slower (1028ms)     |
| 7    | React Fragments (removing wrapper)      | +21.0% slower (1037ms)     |
| 9    | `React.createElement` instead of JSX    | +0.1% slower (858ms)       |
| 10   | `startTransition` for large operations  | +21.8% slower (1044ms)     |
| 11   | Per-row subscriptions                   | +8.1% slower (926ms)       |

### Steps That Showed Minor Improvement

| Step | Approach                            | Result vs Baseline   |
| ---- | ----------------------------------- | -------------------- |
| 4    | React Context with memoized actions | -0.6% faster (852ms) |
| 8    | `useMemo` for entire row list       | -1.9% faster (841ms) |

### Steps That Abandoned React

| Step | Approach                                   | Result vs Baseline  |
| ---- | ------------------------------------------ | ------------------- |
| 13   | Direct DOM manipulation (no React)         | -27% faster (563ms) |
| 14   | Hybrid (React render + imperative updates) | -5% faster (902ms)  |

### Corrected Full Benchmark (including 10K row creation)

| Implementation       | Total | vs Baseline |
| -------------------- | ----- | ----------- |
| Step 8 (useMemo)     | 844ms | -10.6%      |
| Step 12 (imperative) | 878ms | -7.0%       |
| Baseline             | 944ms | --          |

**But Supergrain + `<For>` already achieved ~773ms** -- all optimizations were still slower.

## Why Most Approaches Failed

1. **`useCallback` without fixing root cause:** Wrapping the handler in `useCallback` is useless when you still pass `() => handleSelect(item.id)` as a prop -- that's a new function every render.
2. **Any changing prop breaks `React.memo` entirely:** Passing `dispatch` as a prop defeats memoization just as badly as inline callbacks.
3. **Per-row subscriptions don't scale:** 1000 individual subscriptions create more overhead than 1 shared-state reconciliation pass.
4. **`startTransition` is for UX, not speed:** Designed for responsiveness, not raw benchmark performance. Adds scheduling overhead.
5. **Micro-optimizations (createElement, Fragments) are noise:** JSX compilation and wrapper overhead are negligible.

## What Actually Works in React Performance

**Fix broken memoization first:**

```typescript
// Context provides truly stable references that preserve React.memo
const actions = useMemo(
  () => ({
    select: (id) => dispatch({ type: "SELECT", id }),
  }),
  [dispatch],
); // dispatch from useReducer is stable
```

**Skip reconciliation with `useMemo`:**

```typescript
const rowElements = useMemo(() => {
  return state.data.map(item => <Row key={item.id} item={item} selected={state.selected === item.id} />)
}, [state.data, state.selected])
```

## Key Learnings

1. **React's reconciliation is highly optimized** -- fighting it usually makes things worse.
2. **Fix root causes (broken memoization) before adding optimization layers.**
3. **`React.memo` requires ALL props to be stable.** One changing prop defeats it entirely.
4. **Shared state > individual subscriptions** at typical UI scales (1000+ items).
5. **The original Supergrain + `<For>` was already well-optimized.** This exercise validated that.
6. **Benchmark validation is critical.** Early "fast" results turned out to not render anything.
