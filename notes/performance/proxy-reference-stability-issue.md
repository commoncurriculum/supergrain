# Proxy Reference Stability Issue

> **Status:** FIXED (December 2024)
> **Outcome:** 50x React rendering improvement. React.memo went from broken (2% efficient) to fully working (100% efficient).
> **Root cause:** `useTracked` created new proxy objects on every render instead of reusing cached proxies, breaking all React memoization.
> **Fix:** Global WeakMap-based proxy caching with per-component effect context isolation.

---

## Problem

The `useTracked` React adapter created new proxy objects for array/object items on every render. Since React.memo uses referential equality (`===`) to skip re-renders, every component re-rendered on every state change -- regardless of whether its data actually changed.

### Measured Impact (Before Fix)
- 50/50 rows re-rendered on a single row selection (2% efficient)
- React.memo, useMemo, and useCallback all ineffective
- Performance degraded linearly with list size

### Measured Impact (After Fix)
- 1/50 rows re-renders on selection (100% efficient)
- All React memoization strategies work correctly
- 50x improvement in rendering efficiency

---

## Root Cause

The proxy creation code had no caching layer:

```typescript
// BEFORE: Always creates new proxy, no caching
const createProxy = (target: any): any => {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      return createProxy(value) // New proxy every access
    },
  })
}
```

Every `state.data[i]` access returned a different proxy object, even for identical underlying data. React.memo saw different references and re-rendered everything.

---

## Fix

Added WeakMap-based proxy caching so the same underlying object always returns the same proxy:

```typescript
// AFTER: Reuses existing proxies via WeakMap cache
const proxyCache = new WeakMap<any, any>()

const createProxy = (target: any): any => {
  if (proxyCache.has(target)) {
    return proxyCache.get(target) // Reuse existing proxy
  }
  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      return createProxy(value) // Also cached on recursion
    },
  })
  proxyCache.set(target, proxy)
  return proxy
}
```

### Implementation Details
1. **Global proxy cache:** WeakMap-based caching for consistent identity across renders
2. **Effect context isolation:** Per-component effect tracking without cross-component interference
3. **Recursive stability:** Nested objects and arrays also return stable references
4. **Memory management:** WeakMap prevents leaks; proxies are GC'd when originals are

### Properties Preserved
- Existing `useTracked` API unchanged (zero breaking changes)
- Dependency tracking continues to work correctly
- Works with React.memo, useMemo, useCallback

---

## Verification

### Before Fix (Test Output)
```
Row 1: Original vs Proxied = DIFFERENT  <- Should be SAME
Row 2: Original vs Proxied = DIFFERENT
Row 3: Original vs Proxied = DIFFERENT
Row 1 rendered  <- Shouldn't render
Row 2 rendered  <- Should render (selected)
Row 3 rendered  <- Shouldn't render
```

### After Fix
- Same object returns same proxy reference across renders
- Only components whose data actually changed re-render
- Comprehensive tests validate nested objects, arrays, and deep nesting
