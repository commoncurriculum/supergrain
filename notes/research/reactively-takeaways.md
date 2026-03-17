# Reactively Takeaways for Supergrain

> **TL;DR:** Reactively's 5000x faster reads come from its explicit manual reactivity model (direct `signal.value` access), not from techniques transferable to supergrain's automatic proxy-based tracking. Most initially proposed optimizations would break reactivity. Viable gains are limited to micro-optimizations (5-25% range) and bundle size improvements.

**Status:** Analysis complete. Conclusion: the performance gap is architectural and cannot be closed without abandoning automatic reactivity. Focus shifted to `$$()` direct DOM and `createView` prototype getters instead (see `compiled-reads-investigation.md`).

---

## Core Insight

Reactively uses explicit reactivity (`signal.value`). Supergrain uses automatic reactivity (proxy traps). Every property access in supergrain must register dependencies, creating unavoidable overhead. Attempts to skip this infrastructure break the automatic tracking that is supergrain's core value proposition.

---

## Viable Optimizations (within reactive constraints)

### 1. Proxy Handler Symbol Checks (implemented)

Reduce symbol comparison overhead by checking `typeof property === 'symbol'` before individual comparisons:

```typescript
// Before: 3 sequential === checks on every property access
if (property === $RAW) return target
if (property === $PROXY) return receiver
if (property === $TRACK) { ... }

// After: single typeof guard short-circuits for string properties
if (typeof property === 'symbol' && SPECIAL_SYMBOLS.has(property)) { ... }
```

### 2. Array Length Handling in setProperty (implemented)

Cache length values instead of repeated property access:

```typescript
// Before: multiple property accesses
if (lengthNode && target.length !== (oldValue as any)?.length) {
  lengthNode(target.length)
}

// After: cached values
const newLength = target.length
const oldLength = Array.isArray(oldValue) ? oldValue.length : undefined
if (newLength !== oldLength) { lengthNode(newLength) }
```

### 3. Signal Implementation Micro-optimizations

- Faster dependency registration (arrays instead of Sets where appropriate)
- Optimized equality checks for common types
- Better memory layout to reduce per-signal object overhead
- Batch subscription updates

**Expected impact:** 10-20% improvement

### 4. Memory Layout / Object Pooling

- Pool frequently created objects in proxy traps
- Reduce allocation frequency in hot paths

**Expected impact:** 15-25% memory reduction

### 5. Bundle Size

- Tree shaking improvements via package splitting (`@supergrain/core`, `@supergrain/react`, `@supergrain/dev`)
- Bit flags instead of objects where possible

**Expected impact:** 20-30% size reduction

---

## Rejected Optimizations (would break reactivity)

- Property access caching that bypasses signals
- Fast path proxy handling that skips dependency registration
- Lazy signal creation with inconsistent identity

---

## Implementation Priority

| Phase | Focus | Risk |
|---|---|---|
| 1 | Signal micro-optimizations, observer data structures, allocation reduction, bundle splitting | Low |
| 2 | Optimized WeakMap alternatives, memory layout, batch dependency registration, object pooling | Medium |
| 3 | Custom signal implementation, V8-specific proxy optimizations | High |

---

## Conclusion

The performance difference between Reactively and Supergrain is not a bug to fix -- it's the cost of automatic transparency. Optimization efforts within reactive constraints yield 5-25% improvements. For solid-js-level performance, the path forward is `$$()` direct DOM bindings and `createView` prototype getters, not micro-optimizing the proxy path.
