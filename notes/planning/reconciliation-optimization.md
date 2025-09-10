# Reconciliation Algorithm Optimization Plan

**Date:** September 2025
**Status:** Planning Phase
**Goal:** Eliminate or optimize the reconciliation algorithm in Storable's update process

## Current State Analysis

### Existing Architecture

```typescript
function updateStore(operations: UpdateOperations): void {
  startBatch()
  try {
    applyUpdate(unwrappedState, operations) // Operators modify state
    reconcile(unwrappedState, new Set()) // ← Why is this needed?
  } finally {
    endBatch()
  }
}
```

### What Reconcile Currently Does

```typescript
function reconcile(raw: any, visited: Set<any>) {
  // For each object with signals...
  const nodes = (raw as any)[$NODE]

  // Check EVERY signal against current value
  for (const key of Object.keys(nodes)) {
    const signal = nodes[key]
    const newValue = (raw as any)[key]
    if (signal() !== newValue) {
      signal(newValue) // Update signal
    }
  }

  // Recursively visit ALL nested objects
  for (const key of Object.keys(raw)) {
    reconcile((raw as any)[key], visited)
  }
}
```

## Critical Question: Why Does Reconcile Exist?

### Theory: Operators Should Handle All Updates

Looking at the code flow:

1. **`setProperty` already updates signals**:

   ```typescript
   export function setProperty(target: any, property: PropertyKey, value: any) {
     // ... modify the raw object ...

     const nodes = (target as any)[$NODE]
     if (nodes) {
       const node = nodes[property]
       if (node) {
         node(value) // ← Signal already updated here!
       }
     }
   }
   ```

2. **All operators use `setProperty`**:

   ```typescript
   function $set(target: object, operations: Record<string, unknown>): void {
     for (const path in operations) {
       setPathValue(target, path, operations[path]) // ← Calls setProperty
     }
   }
   ```

3. **So why do we need reconcile?**

### Hypothesis: Reconcile is Redundant

**Primary hypothesis**: The reconcile algorithm is doing duplicate work that `setProperty` already handles.

**Test approach**:

1. Comment out the `reconcile()` call
2. Run all existing tests
3. If tests pass, reconcile is redundant
4. If tests fail, identify what reconcile provides that setProperty doesn't

## Potential Reasons Reconcile Might Be Needed

### 1. **Gap Coverage for Missing setProperty Calls**

Some operator logic might modify objects without calling `setProperty`:

```typescript
// Example: Direct array modification
arr.splice(i, 1) // ← Doesn't call setProperty
```

**Investigation needed**: Audit all operators for direct mutations that bypass `setProperty`.

### 2. **Nested Object Creation**

When paths like `"user.profile.settings.theme"` create intermediate objects:

```typescript
function setPathValue(target: object, path: string, value: unknown): void {
  // Creates intermediate objects
  if (!existing) {
    setProperty(current, part, {}) // ← New object created
  }
  // ... but the new object doesn't have signals yet
}
```

**Potential issue**: New intermediate objects might need signal initialization that only reconcile provides.

### 3. **Lazy Signal Creation**

The current `getNode` function creates signals on-demand:

```typescript
function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any
): Signal<any> {
  if (nodes[property]) {
    return nodes[property]!
  }
  // Create new signal if it doesn't exist
  const newSignal = signal(value)
  nodes[property] = newSignal
  return newSignal
}
```

**Potential issue**: Reconcile might be needed to ensure all properties have signals, not just accessed ones.

## Optimization Strategies

### Strategy 1: Eliminate Reconcile Completely

**Approach**: Fix operators to handle all signal updates directly

**Steps**:

1. **Audit operator functions** - Ensure every mutation calls `setProperty`
2. **Fix direct mutations** - Replace `arr.splice()` with proper `setProperty` calls
3. **Handle intermediate objects** - Ensure new objects get proper signal initialization
4. **Remove reconcile call** - Test that everything still works

**Expected benefit**: ~30-50% improvement in update performance

### Strategy 2: Path-Targeted Reconcile

**Approach**: Only reconcile objects/paths that were actually modified

**Implementation**:

```typescript
interface UpdateContext {
  modifiedPaths: Set<string>
  affectedObjects: WeakSet<object>
}

function applyUpdateWithTracking(
  target: object,
  operations: UpdateOperations,
  context: UpdateContext
): void {
  // Track which paths are modified as operators run
  for (const op in operations) {
    const paths = getOperatorPaths(op, operations[op])
    paths.forEach(path => context.modifiedPaths.add(path))
  }

  applyUpdate(target, operations)
}

function smartReconcile(raw: any, context: UpdateContext): void {
  // Only reconcile specific paths instead of everything
  for (const path of context.modifiedPaths) {
    reconcilePath(raw, path)
  }
}
```

**Expected benefit**: ~20-30% improvement for sparse updates

### Strategy 3: Hybrid Approach

**Approach**: Eliminate reconcile for simple cases, keep for complex ones

**Implementation**:

```typescript
function updateStore(operations: UpdateOperations): void {
  startBatch()
  try {
    applyUpdate(unwrappedState, operations)

    // Only reconcile if operations might have gaps
    if (needsReconciliation(operations)) {
      reconcile(unwrappedState, new Set())
    }
  } finally {
    endBatch()
  }
}

function needsReconciliation(operations: UpdateOperations): boolean {
  // Check if any operators might create situations where reconcile is needed
  return (
    '$rename' in operations || // Moves signals around
    hasNestedObjectCreation(operations) || // Creates intermediate objects
    hasComplexArrayOperations(operations) // Array operations that might miss signals
  )
}
```

**Expected benefit**: ~40-60% improvement for simple updates, no regression for complex ones

## Investigation Plan

### Phase 1: Understanding Current Behavior

1. **Test without reconcile**: Comment out reconcile call, run full test suite
2. **Identify failures**: Which tests fail and why
3. **Gap analysis**: What does reconcile provide that setProperty doesn't?

### Phase 2: Operator Audit

1. **Direct mutation scan**: Find all places operators mutate objects without `setProperty`
2. **Array operation analysis**: Ensure array modifications properly update signals
3. **Path creation analysis**: Verify intermediate object creation works correctly

### Phase 3: Implementation

Based on Phase 1 & 2 findings:

- **If no test failures**: Remove reconcile entirely
- **If specific gaps found**: Fix operators to handle gaps, then remove reconcile
- **If fundamental issues**: Implement path-targeted reconcile

## Performance Analysis Framework

### Benchmarking Approach

```typescript
// Measure reconcile overhead separately
function updateStoreWithMetrics(operations: UpdateOperations): void {
  const startTime = performance.now()

  startBatch()
  try {
    const applyTime = performance.now()
    applyUpdate(unwrappedState, operations)
    const reconcileStart = performance.now()
    reconcile(unwrappedState, new Set())
    const reconcileEnd = performance.now()

    console.log({
      applyTime: reconcileStart - applyTime,
      reconcileTime: reconcileEnd - reconcileStart,
      reconcilePercentage:
        (reconcileEnd - reconcileStart) / (reconcileEnd - startTime),
    })
  } finally {
    endBatch()
  }
}
```

### Test Scenarios

1. **Sparse updates**: Change one property in large object
2. **Deep updates**: Modify nested properties
3. **Array operations**: Push/pull operations on arrays
4. **Bulk updates**: Many properties changed simultaneously
5. **Object creation**: Updates that create new nested objects

## Risk Assessment

### High-Risk Areas

1. **Array operations**: Complex indexing and length management
2. **Nested object creation**: Intermediate objects might lose reactivity
3. **Signal lifecycle**: When are signals created vs. when are they needed?
4. **Edge cases**: Frozen objects, getters/setters, prototype chain

### Mitigation Strategies

1. **Comprehensive testing**: Test all operator combinations
2. **Performance regression testing**: Ensure optimizations don't break performance
3. **Gradual rollout**: Feature flag for new reconciliation strategy
4. **Fallback mechanism**: Keep old reconcile as backup

## Expected Outcomes

### Best Case: Eliminate Reconcile

- **Performance**: 30-50% improvement in update operations
- **Code simplicity**: Remove ~50 lines of reconciliation logic
- **Memory**: Reduce GC pressure from reconcile traversals
- **Maintainability**: Simpler update flow

### Fallback Case: Optimize Reconcile

- **Performance**: 20-30% improvement for typical use cases
- **Reliability**: Maintain current correctness guarantees
- **Complexity**: Moderate increase in tracking logic

## Success Criteria

1. **All existing tests pass** - No regression in functionality
2. **Performance improvement** - Measurable speed increase in benchmarks
3. **Memory efficiency** - No increase in memory usage
4. **Code maintainability** - Simpler or equivalent code complexity

## Next Steps

1. **Run elimination test** - Comment out reconcile, run tests
2. **Performance baseline** - Measure current reconcile overhead
3. **Gap analysis** - Understand what reconcile actually provides
4. **Implementation decision** - Choose elimination vs. optimization based on findings

---

**Key Insight**: The question "why does reconcile exist?" is more important than "how to optimize reconcile." If it's redundant, elimination is better than optimization.
