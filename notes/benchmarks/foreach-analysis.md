# ForEach Benchmark Analysis

## Executive Summary

We conducted extensive benchmarks comparing regular `.map()` rendering vs a `ForEach` component designed to leverage the store's internal signals. While the implementation showed performance improvements in rendering time, it did not achieve the expected reduction in component re-renders.

## Benchmark Results

### Test Environment
- **Platform**: Real browser (Chromium via Playwright)
- **Framework**: React 19.1.1
- **Store**: Storable with alien-signals
- **Test Size**: 10, 100, and 1000 items

### Key Findings

#### 1. Large List Performance (1000 items)
When changing parent state (title):
- **Regular .map()**: 44.90ms, 667 re-renders
- **ForEach**: 19.00ms, 667 re-renders
- **Time saved**: 25.90ms (2.4x faster)
- **Re-render reduction**: 0 (same number of re-renders)

#### 2. Single Item Update (1000 items)
- **Regular .map()**: 28.60ms, 1000 re-renders
- **ForEach**: 31.00ms, 2000 re-renders (worse!)
- **Performance**: Slightly slower with ForEach

#### 3. Small/Medium Lists
- **10 items**: No meaningful difference
- **100 items**: ForEach actually slower (9.5ms vs 2.1ms)

## Why ForEach Didn't Prevent Re-renders

### The Core Issue

1. **Store signals exist**: The store DOES create signals for array indices when accessed
2. **Signal subscription works**: Each ForEach item subscribes to its index's signal
3. **But React still reconciles**: React's reconciliation algorithm still processes all children

### The Problem

```jsx
// Even with signal isolation, React still:
<ForEach each={state.comments}>
  {comment => <Comment comment={comment} />}
</ForEach>

// 1. Calls the render function for ForEach
// 2. Maps over all items
// 3. Creates React elements for each
// 4. Reconciles the entire tree
```

The signal subscription prevents unnecessary effect runs, but doesn't prevent React's reconciliation.

## What Actually Works: React.memo

The real solution isn't complex signal management, but proper use of React.memo:

```jsx
// This is simpler and more effective:
const MemoizedComment = React.memo(Comment)

state.comments.map(comment =>
  <MemoizedComment key={comment.id} comment={comment} />
)
```

## Lessons Learned

### 1. Proxy Overhead Is Real but Acceptable
- 2-15x slower for property access
- But still millions of ops/sec
- The 25ms time savings on 1000 items shows proxies are "fast enough"

### 2. React's Reconciliation Is the Bottleneck
- Signals can't bypass React's reconciliation
- Every child element is still processed by React
- The virtual DOM diff is where time is spent

### 3. The Store's Design Is Already Optimal
- Signals are created lazily for accessed properties
- Fine-grained reactivity works at the signal level
- But React components are the wrong granularity

## Recommendations

### For List Optimization

1. **Use React.memo**: This is the standard, effective solution
2. **Consider virtualization**: For truly large lists (10,000+ items)
3. **Pagination**: Often better than rendering everything

### For the Store/React Adapter

1. **Keep the proxy-based API**: It's fast enough and developer-friendly
2. **Don't expose signals**: The complexity isn't worth it
3. **Focus on ergonomics**: MongoDB-style updates are the real win

### The Ideal API

```jsx
// Simple, no signals exposed
const [state, update] = useStore({ comments: [] })

// Automatic tracking via proxies
const visibleComments = state.comments.filter(c => !c.archived)

// MongoDB-style updates
update({ $push: { comments: newComment } })

// Standard React optimization
const MemoizedComment = React.memo(Comment)
```

## Conclusion

The benchmark proves that while the store's signal-based reactivity is elegant and performant, it can't overcome React's fundamental reconciliation model. The 2.4x performance improvement we saw came from reduced proxy overhead during re-renders, not from preventing re-renders.

**The real value of the store is not in optimizing React rendering, but in providing:**
1. Fine-grained reactivity for effects
2. MongoDB-style updates
3. Automatic dependency tracking
4. A clean, proxy-based API

For React rendering optimization, stick with React's own tools: `React.memo`, `useMemo`, `useCallback`, and virtualization libraries.
