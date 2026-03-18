# Proxy Optimization Trade-offs

> **Status:** Current. Documents proxy handler optimizations in @supergrain/core and what edge-case functionality was intentionally dropped.
> **Result:** 2.69x faster property access overall (22x from Reflect.get removal alone). All 62 tests pass.

## Optimization 1: `Reflect.get` to Direct Property Access

```typescript
// Before
const value = Reflect.get(target, prop, receiver);

// After
const value = (target as any)[prop];
```

**What was dropped:**

- Receiver parameter handling (getter `this` binding)
- Proxy chain handling (nested proxy scenarios)
- Custom property descriptor getter context

**Why safe:** Store objects are plain data containers — no getters, no proxy-wrapping-proxy, no custom descriptors.

**Impact:** 22x faster property access in proxy handler.

## Optimization 2: Removed `hasOwnProperty` Checks

```typescript
// Before: two existence checks per access
const own = Object.prototype.hasOwnProperty.call(target, prop);
if (own) {
  /* ... */
}
if (prop in target) {
  /* ... */
}

// After: direct signal creation
const nodes = getNodes(target);
const node = getNode(nodes, prop, value);
return wrap(node());
```

**What was dropped:**

- Inherited vs own property distinction
- Prototype chain awareness
- Property existence gating before signal creation

**Why safe:** Store objects are plain data without prototype chain manipulation. Signal creation is lazy (only on access).

## Architecture Assumptions (Safety Contract)

These optimizations rely on:

1. **Plain data objects only** — JSON literals, no class instances, no custom prototypes
2. **No prototype chain manipulation** — no `Object.setPrototypeOf()`, no inheritance mixing
3. **No proxy composition** — single-layer proxy wrapping only
4. **Data access only** — no `this` context dependencies, no dynamic descriptors

## Risk Summary

| Risk Level | Scenario                                                                      |
| ---------- | ----------------------------------------------------------------------------- |
| Low        | Plain data, nested objects, arrays, standard reactive patterns                |
| Medium     | Mixed class+store patterns, dynamic property manipulation                     |
| High       | Custom getters on store objects, proxy-wrapping-proxy, complex `this` binding |

High-risk scenarios are outside @supergrain/core's design intent. Users needing complex object behavior should use class-based patterns outside the reactive store.
