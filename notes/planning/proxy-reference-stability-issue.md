# Proxy Reference Stability Issue - Critical Performance Problem

**Date:** September 2025
**Status:** Identified - Needs Investigation & Fix
**Priority:** High - Performance Impact
**Complexity:** Medium-High - Core Architecture

## Problem Statement

The `useTrackedStore` React adapter creates **new proxy objects** for array/object items on every render, instead of reusing existing proxies. This breaks React's optimization strategies and causes significant performance degradation.

## Critical Impact Discovered

During the For Component investigation, we discovered that React.memo fails completely because:

```tsx
// Every render cycle:
state.data.forEach((row, index) => {
  const itemRef = row === originalData[index] ? 'SAME' : 'DIFFERENT'
  console.log(`Row ${row.id}: Original vs Proxied = ${itemRef}`)
})

// Result:
// Row 1: Original vs Proxied = DIFFERENT  ← New proxy every time!
// Row 2: Original vs Proxied = DIFFERENT  ← New proxy every time!
// Row 3: Original vs Proxied = DIFFERENT  ← New proxy every time!
```

This means that ALL React optimization strategies fail:

- ✅ `React.memo` should work → ❌ **Broken** - new object references
- ✅ `useMemo` should work → ❌ **Broken** - dependency arrays always "change"
- ✅ `useCallback` should work → ❌ **Broken** - closure dependencies "change"
- ✅ Component props should be stable → ❌ **Broken** - always different

## Performance Impact

### Current Behavior (Inefficient)

```tsx
// On every render, this creates NEW proxies:
{
  state.data.map(row => (
    <Row
      key={row.id}
      item={row} // ← DIFFERENT object reference every time
      isSelected={row.id === state.selected}
    />
  ))
}

// Result: ALL 1000 components re-render when selecting 1 row
// Efficiency: 1% (should be ~50% with proper memoization)
```

### Expected Behavior (Efficient)

```tsx
// Should reuse same proxy objects:
{
  state.data.map(row => (
    <Row
      key={row.id}
      item={row} // ← SAME object reference if data unchanged
      isSelected={row.id === state.selected} // ← Only this prop changes
    />
  ))
}

// Result: Only 2 components re-render (prev + new selection)
// Efficiency: 50%+ with React.memo working properly
```

### Measured Impact

- **Current**: 50/50 rows re-render on selection (2% efficient)
- **With working memo**: Should be 2/50 rows re-render (96% efficient)
- **Performance gain potential**: ~25x improvement in React rendering

## Root Cause Analysis

### Suspected Implementation Issue

The `useTrackedStore` proxy system likely:

1. **Creates proxies on-demand** during property access
2. **Doesn't cache/reuse** proxy objects for the same underlying data
3. **Generates new proxy** for each `state.data[i]` access
4. **Has no identity preservation** between render cycles

### Current Proxy Architecture (Suspected)

```tsx
// In useTrackedStore implementation:
const createProxy = (target: any): any => {
  // Problem: Always creates new proxy, no caching
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      return createProxy(value) // ← New proxy every access!
    },
  })
}
```

### Required Architecture (Solution)

```tsx
// Should use WeakMap for proxy caching:
const proxyCache = new WeakMap<any, any>()

const createProxy = (target: any): any => {
  if (proxyCache.has(target)) {
    return proxyCache.get(target) // ← Reuse existing proxy
  }

  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      return createProxy(value) // ← This would also be cached
    },
  })

  proxyCache.set(target, proxy)
  return proxy
}
```

## Evidence from Investigation

### Test Results

```
=== REACT.MEMO INVESTIGATION ===
=== RENDER CYCLE START ===
Row 1: Original vs Proxied = DIFFERENT
Row 2: Original vs Proxied = DIFFERENT
Row 3: Original vs Proxied = DIFFERENT
Row 1 rendered - item reference: object, isSelected: false
Row 2 rendered - item reference: object, isSelected: false
Row 3 rendered - item reference: object, isSelected: false

--- SELECTING ROW 2 ---
=== RENDER CYCLE START ===
Row 1: Original vs Proxied = DIFFERENT  ← Should be SAME!
Row 2: Original vs Proxied = DIFFERENT  ← Should be SAME!
Row 3: Original vs Proxied = DIFFERENT  ← Should be SAME!
Row 1 rendered - item reference: object, isSelected: false  ← Shouldn't render!
Row 2 rendered - item reference: object, isSelected: true   ← Should render
Row 3 rendered - item reference: object, isSelected: false  ← Shouldn't render!
```

### Performance Benchmarks Confirming Issue

- **Hook-only selection**: 4,564 ops/sec (good - no memo needed)
- **Full DOM selection**: 21 ops/sec (bad - memo should help but doesn't)
- **All approaches identical**: Proving memo optimizations don't work

## Fix Requirements

### 1. Proxy Identity Preservation

- **Same object** → **Same proxy reference** across renders
- **Different object** → **Different proxy reference**
- **Stable caching** that survives component re-renders

### 2. Nested Object Handling

- Arrays of objects: `state.users[0]` should be stable
- Nested objects: `state.user.profile` should be stable
- Deep nesting: `state.company.departments[0].employees` should be stable

### 3. Memory Management

- **WeakMap usage** to prevent memory leaks
- **Automatic cleanup** when original objects are garbage collected
- **Efficient caching** without performance overhead

### 4. React Integration

- Must work with `React.memo`, `useMemo`, `useCallback`
- Should not break existing `useTrackedStore` API
- Must maintain dependency tracking functionality

## Investigation Tasks

### Phase 1: Confirm Root Cause

- [ ] Examine current `useTrackedStore` implementation
- [ ] Identify where new proxies are created
- [ ] Confirm no proxy caching exists
- [ ] Measure proxy creation overhead

### Phase 2: Design Solution

- [ ] Design proxy caching architecture
- [ ] Plan WeakMap-based identity preservation
- [ ] Consider edge cases (nested objects, arrays, mutations)
- [ ] Design memory management strategy

### Phase 3: Implementation

- [ ] Implement proxy caching system
- [ ] Update `useTrackedStore` to use cached proxies
- [ ] Ensure dependency tracking still works
- [ ] Add comprehensive tests

### Phase 4: Validation

- [ ] Verify React.memo now works correctly
- [ ] Measure performance improvements
- [ ] Test with complex nested data structures
- [ ] Ensure no memory leaks

## Success Criteria

### Performance Targets

- **Row selection efficiency**: From 2% → 50%+ (25x improvement)
- **React.memo success**: 2/50 components render instead of 50/50
- **Large dataset scaling**: Should improve dramatically for 1000+ items

### Functional Requirements

- ✅ Existing `useTrackedStore` API unchanged
- ✅ Dependency tracking continues to work
- ✅ React.memo, useMemo, useCallback work properly
- ✅ No memory leaks or reference issues
- ✅ Nested objects/arrays handled correctly

### Test Cases

```tsx
// This should work after fix:
const MemoizedRow = memo(({ item, isSelected }) => {
  // Should only render when isSelected changes
  return <tr className={isSelected ? 'selected' : ''}>{item.name}</tr>
})

// Usage should be efficient:
{
  state.data.map(row => (
    <MemoizedRow
      key={row.id}
      item={row} // ← Same reference for same data
      isSelected={row.id === selected}
    />
  ))
}
```

## Risk Assessment

### Technical Risks

- **Breaking existing functionality** - Dependency tracking might break
- **Memory leaks** - Improper WeakMap usage could cause issues
- **Performance regression** - Caching overhead might be significant
- **Complex edge cases** - Nested proxy handling is tricky

### Migration Risks

- **API compatibility** - Must not break existing components
- **Behavioral changes** - Components might behave differently with stable refs
- **Testing coverage** - Need comprehensive tests for all scenarios

## Business Impact

### Current State

- React optimizations completely broken
- Poor performance with large datasets
- Developer frustration with "slow" rendering
- Potential for users to avoid storable for performance-critical UIs

### After Fix

- React optimizations work as expected
- ~25x improvement in rendering efficiency for lists
- Competitive performance with other state libraries
- Developer confidence in storable for complex UIs

## Related Issues

- For Component investigation revealed this issue
- Previous benchmarks showing poor React performance
- Developer reports of slow table/list rendering
- Complaints about React.memo not working

## Next Steps

1. **Assign to React specialist** with proxy/WeakMap expertise
2. **Create detailed investigation branch** for experimentation
3. **Implement comprehensive benchmarks** to measure improvements
4. **Plan careful rollout** to avoid breaking existing applications

---

**This is a critical architectural fix that could dramatically improve React performance.**
**The proxy reference stability issue affects ALL React optimization strategies.**
**Fixing this should be a high priority for the next development cycle.**
