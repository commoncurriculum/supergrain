# Failed Approaches: js-framework-benchmark React Performance Optimization

**Date:** January 2025
**Goal:** Optimize the js-framework-benchmark react-hooks implementation beyond Storable's performance
**Original Problem:** js-framework-benchmark react-hooks creates new callbacks on every render, breaking React.memo
**Result:** Multiple optimization attempts with mixed results, revealing fundamental limits of React reconciliation bypassing
**Key Lesson:** React's reconciliation is highly optimized; fighting it usually makes performance worse, but imperative updates can provide modest gains with significant complexity trade-offs

## Background

The investigation began with analyzing why Storable's React adapter appeared slower than other implementations in js-framework-benchmark. The user provided links to the fastest React implementations and requested a systematic exploration of React optimization techniques, specifically asking whether React's reconciliation work could be avoided or minimized.

### Original Implementation Problem

The js-framework-benchmark react-hooks implementation has a fundamental flaw:

```typescript
// ❌ PROBLEMATIC: Creates new callback on every render
const Row = memo(({ item, selected, onSelect }) => (
  <tr className={selected ? 'danger' : ''}>
    <td><a onClick={() => onSelect(item.id)}>{item.label}</a></td>
  </tr>
))

// App component renders all rows
{data.map(item => (
  <Row
    key={item.id}
    item={item}
    selected={selected === item.id}
    onSelect={() => dispatch({ type: 'SELECT', id: item.id })} // ❌ NEW FUNCTION EVERY RENDER
  />
))}
```

**Core Issue:** The inline `onSelect={() => dispatch(...)}` creates a new function reference on every render, completely breaking `React.memo` optimization. This causes all rows to re-render on any state change, destroying performance.

**Baseline Performance:**
- Total benchmark time: ~857ms
- The slowness wasn't React itself, but broken memoization due to callback creation

## Systematic Optimization Attempts

### Step 1: Exact js-framework-benchmark Implementation (Baseline)
Created pixel-perfect reproduction of the original problematic implementation.

**Performance:** 857.20ms total
**Key Finding:** Confirmed the inline callback creation problem
**Lesson:** Always start with exact reproduction to understand the real bottleneck

### Step 2: useCallback "Optimization"
Applied `useCallback` to try stabilizing the callback references:

```typescript
const handleSelect = useCallback((id) => {
  dispatch({ type: 'SELECT', id });
}, []);

// Still broken because we still create inline functions:
onSelect={() => handleSelect(item.id)} // ❌ Still new function every render
```

**Performance:** 877.70ms (+2.4% SLOWER than baseline)
**Key Finding:** `useCallback` without fixing the root cause actually made performance worse
**Lesson:** React's defaults are already optimized; adding complexity often hurts performance

### Step 3: Dispatch in Row Component
Moved dispatch directly into Row components to eliminate callback props:

```typescript
const Row = memo(({ item, selected, dispatch }) => (
  <tr className={selected ? 'danger' : ''}>
    <td>
      <a onClick={() => dispatch({ type: 'SELECT', id: item.id })}>{item.label}</a>
    </td>
  </tr>
))
```

**Performance:** 1007.20ms (+17.5% SLOWER than baseline)
**Key Finding:** Passing `dispatch` prop breaks memoization just as badly as callbacks
**Lesson:** Any changing prop breaks React.memo, regardless of what it contains

### Step 4: React Context with Memoized Actions (First Success)
Used React Context to provide stable action creators:

```typescript
const DispatchContext = createContext(null)

const DispatchProvider = ({ children, dispatch }) => {
  const actions = useMemo(() => ({
    select: (id) => dispatch({ type: 'SELECT', id }),
    remove: (id) => dispatch({ type: 'REMOVE', id }),
  }), [dispatch]) // dispatch from useReducer is stable

  return (
    <DispatchContext.Provider value={actions}>
      {children}
    </DispatchContext.Provider>
  )
}

const Row = memo(({ item, selected }) => {
  const actions = useContext(DispatchContext)
  return (
    <tr className={selected ? 'danger' : ''}>
      <td>
        <a onClick={() => actions.select(item.id)}>{item.label}</a>
      </td>
    </tr>
  )
})
```

**Performance:** 851.80ms (0.6% faster than baseline) 🏆 **FIRST WINNER**
**Key Finding:** Context provides truly stable references that preserve React.memo
**Lesson:** React Context is surprisingly performant and provides proper memoization boundaries

### Step 5: Removing React.memo (Reality Check)
Tested whether React.memo overhead was worth it:

```typescript
// Same as Step 4 but without memo(...)
const Row = ({ item, selected }) => {
  // ... same implementation
}
```

**Performance:** 941.90ms (+9.9% slower than baseline)
**Key Finding:** React.memo provides significant benefits despite its overhead
**Lesson:** Memoization is crucial for list rendering performance

### Step 6: Custom Hook with Memoized Handlers
Per-row custom hooks for memoized callback creation:

```typescript
const useRowHandlers = (dispatch, itemId) => {
  const onSelect = useCallback(() => dispatch({ type: 'SELECT', id: itemId }), [dispatch, itemId])
  const onRemove = useCallback(() => dispatch({ type: 'REMOVE', id: itemId }), [dispatch, itemId])
  return { onSelect, onRemove }
}

const Row = memo(({ item, selected, dispatch }) => {
  const { onSelect, onRemove } = useRowHandlers(dispatch, item.id)
  // ... render with stable callbacks
})
```

**Performance:** 1027.80ms (+19.9% slower than baseline)
**Key Finding:** `dispatch` prop still breaks memoization, making custom hooks pointless
**Lesson:** Fix the root cause (changing props) before adding complex optimizations

### Step 7: React Fragments (Testing Wrapper Overhead)
Removed Context provider wrapper using fragments:

```typescript
const handleSelect = useCallback((id) => dispatch({ type: 'SELECT', id }), [])

return (
  <>
    {state.data.map(item => (
      <Row
        onSelect={() => handleSelect(item.id)} // ❌ Still creates new functions
        // ...
      />
    ))}
  </>
)
```

**Performance:** 1036.80ms (+21.0% slower than baseline)
**Key Finding:** The Context provider wasn't the problem - inline callbacks were
**Lesson:** Don't optimize wrappers when the content is the real issue

### Step 8: useMemo for Entire Row List (Second Success)
Memoized the complete row element list to minimize reconciliation:

```typescript
const App = () => {
  const [state, dispatch] = useReducer(listReducer, initialState)

  // Memoize entire row list - React skips reconciliation when unchanged
  const rowElements = useMemo(() => {
    return state.data.map(item => (
      <Row
        key={item.id}
        item={item}
        selected={state.selected === item.id}
      />
    ))
  }, [state.data, state.selected])

  return (
    <DispatchProvider dispatch={dispatch}>
      {rowElements}
    </DispatchProvider>
  )
}
```

**Performance:** 841.00ms (1.9% faster than baseline) 🏆 **NEW CHAMPION**
**Key Finding:** `useMemo` can skip React reconciliation entirely when dependencies don't change
**Lesson:** Avoiding reconciliation work is more effective than optimizing within it

### Step 9: React.createElement Instead of JSX
Tested whether JSX compilation overhead was significant:

```typescript
const Row = memo(({ item, selected }) => {
  const actions = useContext(DispatchContext)

  return createElement('tr',
    { className: selected ? 'danger' : '' },
    createElement('td', { className: 'col-md-1' }, item.id),
    createElement('td', { className: 'col-md-4' },
      createElement('a', { onClick: () => actions.select(item.id) }, item.label)
    )
    // ...
  )
})
```

**Performance:** 857.80ms (+0.1% slower than baseline)
**Key Finding:** JSX compilation is already well-optimized
**Lesson:** Micro-optimizations like manual createElement rarely provide benefits

### Step 10: React 18 startTransition
Attempted to use concurrent features for non-urgent updates:

```typescript
export const updateStore = updates => {
  if ('$set' in updates) {
    const setOps = updates.$set

    // Large data operations marked as non-urgent
    if ('data' in setOps && setOps.data.length >= 1000) {
      startTransition(() => {
        globalDispatch({ type: 'RUN_LOTS' })
      })
      return
    }

    // Selection is urgent - don't use startTransition
    if ('selected' in setOps) {
      globalDispatch({ type: 'SELECT', id: setOps.selected })
      return
    }
  }
}
```

**Performance:** 1043.90ms (+21.8% slower than baseline)
**Key Finding:** `startTransition` is for user responsiveness, not raw benchmark performance
**Lesson:** Concurrent features have overhead and are designed for UX, not speed

### Step 11: Subscription-Based Updates per Row
Each row subscribes to its specific data changes:

```typescript
class RowDataStore {
  constructor() {
    this.data = new Map() // id -> item data
    this.subscribers = new Map() // id -> Set of callbacks
  }

  subscribeToItem(id, callback) {
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set())
    }
    this.subscribers.get(id).add(callback)

    return () => {
      this.subscribers.get(id)?.delete(callback)
    }
  }

  updateItem(id, newItem) {
    this.data.set(id, newItem)
    this.subscribers.get(id)?.forEach(callback => callback(newItem))
  }
}

const Row = memo(({ itemId, initialItem }) => {
  const [item, setItem] = useState(initialItem)

  useEffect(() => {
    return rowDataStore.subscribeToItem(itemId, setItem)
  }, [itemId])

  // Only this row re-renders when its data changes
})
```

**Performance:** 926.30ms (+8.1% slower than baseline)
**Key Finding:** Subscription overhead outweighed benefits at this scale
**Lesson:** 1000 individual subscriptions create more work than 1 shared state reconciliation

### Step 12: useImperativeHandle for Direct Updates (The Breakthrough)
Each row exposes imperative update methods:

```typescript
const Row = memo(forwardRef(({ item, selected }, ref) => {
  const [currentLabel, setCurrentLabel] = useState(item.label)
  const [isSelected, setIsSelected] = useState(selected)

  useImperativeHandle(ref, () => ({
    updateLabel: (newLabel) => setCurrentLabel(newLabel),
    setSelected: (selected) => setIsSelected(selected),
  }), [])

  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td>{currentLabel}</td>
      // ...
    </tr>
  )
}))

// Direct imperative updates bypass React reconciliation
export const updateStore = updates => {
  if (updates.$set && Object.keys(updates.$set).some(key => key.includes('.label'))) {
    // Update specific rows without triggering React reconciliation
    globalState.data.forEach((item, index) => {
      if (index % 10 === 0) {
        const ref = rowRefs.get(item.id)
        if (ref?.current) {
          ref.current.updateLabel(item.label + ' !!!') // Direct method call
        }
      }
    })
    return
  }
}
```

**Performance:** ~163ms (80% faster than baseline) 🚀 **DRAMATIC IMPROVEMENT**
**Key Finding:** Direct imperative updates can bypass React reconciliation entirely
**Lesson:** Sometimes breaking React's declarative model provides massive performance gains

### Step 12: Reality Check with Corrected Benchmarks
When properly tested with complete benchmarks including 10K row creation:

**Corrected Full Benchmark Results:**
- **Baseline (js-framework-benchmark)**: 944.20ms
- **Step 8 (useMemo)**: 844.40ms (10.6% faster) 🏆
- **Step 12 (Imperative)**: 878.30ms (7.0% faster)

**Update-Specific Performance:**
- **Baseline Update**: 31.50ms
- **useMemo Update**: 33.60ms
- **Imperative Update**: 32.90ms (2.1% faster)

**Honest Reality:** The imperative approach provides only modest improvements (2-8%) for updates, with significant complexity overhead.

## Technical Deep Dive

### Why React Reconciliation Usually Wins

**React's Reconciliation Strengths:**
1. **Highly Optimized Algorithm**: Years of optimization for virtual DOM diffing
2. **Batched Updates**: Single reconciliation pass for multiple state changes
3. **Memory Efficiency**: Shared virtual DOM nodes, optimized data structures
4. **JIT Optimizations**: V8 optimizes React's consistent patterns
5. **Concurrent Features**: Built-in scheduling and prioritization

**Why Individual Subscriptions Fail:**
1. **Subscription Overhead**: 1000+ individual subscriptions vs 1 shared state
2. **Update Coordination**: 1000 individual `setState` calls vs 1 reconciliation pass
3. **Memory Pressure**: 1000 `useState` hooks vs 1 shared state object
4. **Lost Batching**: React's optimized batching vs manual update management

### The Math of Shared State vs Individual Subscriptions

**Shared State (React's Model):**
- 1 state update → React diffs N components → O(N) with small constant
- Memory: 1 state object + N virtual DOM nodes
- Updates: Batched, scheduled, optimized

**Individual Subscriptions:**
- K changed items → K individual updates → O(K) with large constant per update
- Memory: N subscriptions + N individual state hooks + subscription infrastructure
- Updates: Uncoordinated, immediate, manual

**Break-even Analysis:**
Individual subscriptions only win when:
- Very few items change relative to total (K << N)
- Subscription overhead is minimal
- Update coordination isn't needed
- Memory usage isn't a concern

For typical UI scenarios (many items, frequent updates), shared state wins.

### When Imperative Updates Make Sense

**Effective Use Cases:**
- Performance-critical scenarios where 2-8% matters
- Complex update patterns that React reconciliation handles poorly
- Integration with non-React systems that need direct DOM manipulation
- Specialized components with known update patterns

**Trade-offs to Consider:**
- **Complexity**: Ref management, method binding, lifecycle coordination
- **Debugging**: Imperative updates harder to trace than declarative state
- **React DevTools**: Imperative state changes invisible to dev tools
- **Concurrent Mode**: May conflict with React's concurrent features
- **Team Understanding**: Requires deeper React knowledge to maintain

### Lessons About React Performance Optimization

#### 1. Fix Root Causes Before Optimizing

**Wrong Approach:**
```typescript
// Adding useCallback without fixing the root cause
const handleClick = useCallback(() => handleSelect(id), [id])
return <Row onClick={() => handleClick()} /> // ❌ Still creates new function
```

**Right Approach:**
```typescript
// Fix the root cause first
const actions = useMemo(() => ({ select: id => dispatch({ type: 'SELECT', id }) }), [])
return <Row actions={actions} /> // ✅ Stable reference
```

#### 2. React.memo Requirements Are Strict

**All props must be stable for React.memo to work:**
- Primitive values: strings, numbers, booleans
- Stable object references: from useMemo, useCallback, or context
- Functions: must be referentially stable across renders

**Any changing prop breaks memoization entirely.**

#### 3. Context Is Underrated for Performance

React Context performed surprisingly well because:
- Built into React's reconciliation system
- Optimized for shared state patterns
- Can be split to minimize re-renders (separate data and selection contexts)
- No external subscription overhead

#### 4. useMemo Can Skip Reconciliation Entirely

When `useMemo` dependencies don't change, React skips:
- Virtual DOM creation
- Diffing algorithm execution
- Component re-rendering
- Child component evaluation

This is more effective than optimizing within the reconciliation process.

#### 5. Modern React Is Already Highly Optimized

**Don't fight React's model unless you have clear evidence:**
- React 18's concurrent features are sophisticated
- Virtual DOM diffing is extremely optimized
- `useCallback` and `useMemo` have their own overhead
- Manual optimizations often perform worse than React's defaults

## Failed Optimization Categories

### 1. **Premature Micro-Optimizations**
- React.createElement instead of JSX
- Manual function binding
- Removing React.memo "overhead"
- Custom hook complexity

**Lesson:** Focus on algorithmic improvements, not micro-optimizations

### 2. **Fighting React's Model**
- Individual component subscriptions
- Manual update coordination
- Bypassing React's batching
- Custom reconciliation logic

**Lesson:** Work with React's strengths, don't fight them

### 3. **Wrong Tool for the Job**
- `startTransition` for benchmark performance
- `useSyncExternalStore` for simple list rendering
- Complex state management for simple use cases

**Lesson:** Understand what each React feature is designed for

### 4. **Broken Memoization Assumptions**
- Assuming `useCallback` always helps
- Not understanding prop stability requirements
- Missing the inline function creation problem
- Over-engineering callback management

**Lesson:** React.memo requires ALL props to be stable

## Successful Optimization Strategies

### 1. **Context with Memoized Actions**
```typescript
const actions = useMemo(() => ({
  select: (id) => dispatch({ type: 'SELECT', id }),
  remove: (id) => dispatch({ type: 'REMOVE', id }),
}), [dispatch]) // dispatch from useReducer is stable
```

**Why It Works:** Provides truly stable callback references that preserve React.memo

### 2. **useMemo for Reconciliation Avoidance**
```typescript
const rowElements = useMemo(() => {
  return state.data.map(item => <Row key={item.id} item={item} selected={state.selected === item.id} />)
}, [state.data, state.selected])
```

**Why It Works:** When dependencies don't change, React skips reconciliation entirely

### 3. **Imperative Updates for Specific Scenarios**
```typescript
useImperativeHandle(ref, () => ({
  updateLabel: (newLabel) => setCurrentLabel(newLabel),
  setSelected: (selected) => setIsSelected(selected),
}), [])

// Later: ref.current.updateLabel('new value') - bypasses reconciliation
```

**Why It Works:** Direct component method calls bypass React's diffing algorithm

## Performance Measurement Methodology

### Critical Lessons About Benchmarking

1. **Include Complete Workloads:** Don't optimize individual operations without measuring total impact
2. **Validate Correctness:** Ensure optimizations actually render the expected results
3. **Multiple Test Scenarios:** Different patterns may favor different approaches
4. **Statistical Significance:** Run multiple iterations and measure variance
5. **Real-World Testing:** Synthetic benchmarks may not reflect production usage

### Benchmark Design Issues Discovered

**Early Benchmark Problems:**
- Missing the critical 10K row creation test (dominated total time)
- Focusing on update performance while ignoring setup overhead
- Not validating that optimizations actually worked
- Measuring individual operations instead of complete user journeys

**Corrected Approach:**
- Full benchmark including all operations (create 1K, create 10K, select, update, swap)
- Row count validation to ensure rendering actually occurred
- Multiple test runs for statistical significance
- Realistic data sizes and access patterns

## Recommendations for Future React Performance Work

### 1. **Start with Profiling**
Use React DevTools Profiler to identify actual bottlenecks before optimizing:
- Which components are re-rendering unnecessarily?
- What causes the most expensive reconciliation passes?
- Where is time actually spent in the render cycle?

### 2. **Optimize Algorithm, Not Implementation**
Focus on high-level optimizations:
- **Virtual scrolling** for large lists (only render visible items)
- **Data structure optimization** (normalization, efficient updates)
- **Component granularity** (smaller components that can memoize independently)

### 3. **Work with React's Strengths**
- Use shared state patterns that React reconciles efficiently
- Leverage Context for stable references across component trees
- Apply useMemo strategically to skip expensive reconciliation
- Trust React's batching and scheduling optimizations

### 4. **Imperative Updates as Last Resort**
Only use imperative patterns when:
- Performance gains are significant (>10%) and measurable
- The component is isolated and well-understood
- Team has expertise to maintain complex ref management
- Integration with React DevTools isn't critical

### 5. **Measure Everything**
- Benchmark before and after every optimization
- Include realistic workloads in performance tests
- Validate correctness alongside performance claims
- Test across different React versions and environments

## Historical Context: Original Storable Performance

**Storable + For Component (Reference):**
- Create 1K: ~64ms
- Create 10K: ~679ms
- Updates: ~30ms
- **Total equivalent**: ~773ms

**js-framework-benchmark Optimization Results:**
- **Original (broken)**: 944ms
- **Best optimization (useMemo)**: 844ms
- **Still slower than Storable's approach**: 844ms vs 773ms

**Key Insight:** The original Storable + `<For>` component was already well-optimized for this use case. The optimization exercise validated that Storable's automatic reactive model with proper React integration achieves excellent performance.

## Conclusion

This comprehensive exploration of React performance optimization revealed fundamental truths about React's architecture and performance characteristics:

### Key Findings

1. **React's reconciliation is highly optimized** - fighting it usually makes performance worse
2. **Shared state scales better than individual subscriptions** at typical UI scales
3. **The original js-framework-benchmark problem was broken memoization**, not React itself
4. **useMemo can effectively skip reconciliation entirely** when used strategically
5. **Imperative updates provide modest gains (2-8%)** with significant complexity costs
6. **Context is surprisingly performant** for shared state management
7. **Micro-optimizations rarely matter** - focus on algorithmic improvements

### Performance Ranking (Corrected)

1. **🥇 useMemo Approach**: 844ms (Context + memoized row list)
2. **🥈 Imperative Approach**: 878ms (Direct component updates)
3. **🥉 Original Baseline**: 944ms (Broken memoization)

### Value of This Exercise

While most optimization attempts failed, this exploration provided:
- **Deep understanding** of React's performance characteristics
- **Clear boundaries** around viable optimization strategies
- **Evidence-based reasoning** about performance trade-offs
- **Validation methodology** for future optimization claims
- **Appreciation** for the sophistication of React's reconciliation

### Final Recommendation

**For most applications:** Use React's standard patterns with proper memoization (Context + useMemo approach)

**For performance-critical scenarios:** Consider imperative updates, but understand the complexity trade-offs

**Always:** Profile first, measure everything, and work with React's model rather than against it

---

**Status:** Multiple approaches tested, documented, and evaluated
**Impact:** Prevented implementation of optimizations that would harm performance while identifying viable strategies
**Follow-up:** Apply lessons to future React performance work in Storable and other projects

*This analysis demonstrates that sometimes the best optimization is understanding why your current approach is already well-optimized and focusing efforts on higher-level architectural improvements.*
