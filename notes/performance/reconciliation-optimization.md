# Reconciliation Algorithm Optimization

> **Status:** PLANNING -- investigation not yet executed
> **Goal:** Determine if the `reconcile()` step in `updateStore` is redundant, and eliminate or optimize it.
> **Hypothesis:** `setProperty` already updates signals during mutations, so reconcile may be doing duplicate work.
> **Expected benefit:** 30-50% update performance improvement if reconcile can be eliminated entirely.

---

## Current Architecture

```typescript
function updateStore(operations: UpdateOperations): void {
  startBatch()
  try {
    applyUpdate(unwrappedState, operations) // Operators modify state
    reconcile(unwrappedState, new Set())    // <- Why is this needed?
  } finally {
    endBatch()
  }
}
```

### What reconcile() Does

After operators run, reconcile walks the entire state tree and compares every signal's value to the actual object value. If they differ, it updates the signal:

```typescript
function reconcile(raw: any, visited: Set<any>) {
  const nodes = (raw as any)[$NODE]
  for (const key of Object.keys(nodes)) {
    const signal = nodes[key]
    const newValue = (raw as any)[key]
    if (signal() !== newValue) {
      signal(newValue) // Update signal to match actual value
    }
  }
  // Recursively visit ALL nested objects
  for (const key of Object.keys(raw)) {
    reconcile((raw as any)[key], visited)
  }
}
```

### Why It Might Be Redundant

`setProperty` already updates signals when operators mutate state:

```typescript
export function setProperty(target: any, property: PropertyKey, value: any) {
  // ... modify the raw object ...
  const nodes = (target as any)[$NODE]
  if (nodes) {
    const node = nodes[property]
    if (node) {
      node(value) // Signal already updated here
    }
  }
}
```

All operators use `setProperty`, so signals should already be in sync after `applyUpdate`.

---

## Possible Reasons Reconcile Is Still Needed

### 1. Direct Mutations Bypassing setProperty
Some operator logic might modify objects without going through `setProperty`:
```typescript
arr.splice(i, 1) // Direct array mutation -- no setProperty call
```
**Action:** Audit all operators for direct mutations.

### 2. Nested Object Creation via Deep Paths
When setting `"user.profile.settings.theme"`, intermediate objects may be created without proper signal initialization:
```typescript
function setPathValue(target, path, value) {
  if (!existing) {
    setProperty(current, part, {}) // New object, but no signals yet
  }
}
```

### 3. Lazy Signal Creation Gap
Signals are created on first reactive access (via `getNode`). Reconcile may be needed to sync signals that were created *after* the mutation that should have updated them.

---

## Proposed Investigation

### Phase 1: Test Elimination
1. Comment out the `reconcile()` call
2. Run full test suite
3. If all tests pass: reconcile is redundant, remove it
4. If tests fail: identify exactly what reconcile provides that setProperty doesn't

### Phase 2: Operator Audit
1. Scan all operators for direct mutations that bypass `setProperty`
2. Verify array modifications properly update signals
3. Check intermediate object creation during deep path setting

### Phase 3: Implement Fix
- **If no test failures:** Remove reconcile entirely
- **If specific gaps found:** Fix operators to close the gaps, then remove reconcile
- **If fundamental issues:** Implement path-targeted reconcile (only reconcile modified paths)

---

## Optimization Strategies (If Elimination Fails)

### Path-Targeted Reconcile
Only reconcile objects/paths that were actually modified, rather than walking the entire tree:

```typescript
interface UpdateContext {
  modifiedPaths: Set<string>
  affectedObjects: WeakSet<object>
}

function smartReconcile(raw: any, context: UpdateContext): void {
  for (const path of context.modifiedPaths) {
    reconcilePath(raw, path)
  }
}
```
**Expected benefit:** 20-30% improvement for sparse updates.

### Hybrid Approach
Skip reconcile for simple operations, keep it only for complex ones (`$rename`, nested object creation, complex array operations):
**Expected benefit:** 40-60% improvement for simple updates, no regression for complex ones.

---

## Benchmarking Approach

```typescript
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

Test scenarios: sparse updates (1 property in large object), deep updates, array operations, bulk updates, nested object creation.

---

## Key Insight

The question "why does reconcile exist?" is more important than "how to optimize reconcile." If it's redundant, elimination is better than optimization.
