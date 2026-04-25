# Safe Compile-Time Optimizations for @supergrain/kernel

> **Status:** Design document -- not implemented. Superseded in part by the Vite compiler plugin investigation (see [vite-compiler-plugin-plan.md](./vite-compiler-plugin-plan.md)), which pursued a narrower version of these ideas and found that compiled `readSignal` calls were slower than proxy reads in practice (see [compiled-reads-investigation.md](../performance/compiled-reads-investigation.md)).
>
> **TL;DR:** Four compile-time optimization strategies that specialize runtime code paths using static type information, without breaking reactivity. Estimated 30-60% combined improvement. All remain theoretical -- no benchmarks were run on these specific strategies.

## Core Constraint

From [failed approaches analysis](../failed-approaches/):

> **Every property access in reactive context MUST register dependencies.**
> **Signal identity consistency cannot be optimized away.**

Any compile-time optimization must work as specialization of existing behavior, not as a bypass of reactivity.

## Proposed Optimizations

### 1. Proxy Handler Code Generation

Generate optimized proxy handlers for known object shapes at compile time.

**Current generic handler** checks for `$RAW`, `$PROXY`, function types, `getCurrentSub()`, `hasOwnProperty`, etc. on every access.

**Optimized handler** (for known shape `{ count: number, name: string }`):

```typescript
const optimizedHandler: ProxyHandler<{ count: number; name: string }> = {
  get(target, prop, receiver) {
    if (prop === $RAW) return target;
    if (prop === $PROXY) return receiver;

    const value = Reflect.get(target, prop, receiver);
    if (typeof value === "function") return value;

    const currentSub = getCurrentSub(); // Cache the call
    if (!currentSub) return wrap(value);

    // Shape-specific fast path
    if (prop === "count" || prop === "name") {
      const nodes = getNodes(target);
      const node = getNode(nodes, prop, value);
      return wrap(node());
    }

    // Fallback for unexpected properties
    return genericGet(target, prop, receiver);
  },
};
```

**Expected improvement:** 15-25%. Eliminates unnecessary checks for known properties, caches `getCurrentSub()`.

### 2. Signal Structure Pre-allocation

Pre-allocate signal data structures based on TypeScript interfaces instead of lazy runtime allocation.

**Current:** `getNodes()` lazily creates node maps with `Object.create(null)` + `Object.defineProperty` on first access.

**Compiled:**

```typescript
function createUserStore(initialData: UserStore) {
  const rootNodes = Object.create(null);
  rootNodes.count = signal(initialData.count);
  rootNodes.name = signal(initialData.name);
  rootNodes.nested = signal(initialData.nested);

  const nestedNodes = Object.create(null);
  nestedNodes.value = signal(initialData.nested.value);

  Object.defineProperty(initialData, $NODE, { value: rootNodes });
  Object.defineProperty(initialData.nested, $NODE, { value: nestedNodes });

  return createGrainProxy(initialData);
}
```

**Expected improvement:** 10-20%. Eliminates runtime allocation and `defineProperty` overhead on first access.

### 3. Type-Aware Wrap Function Generation

Generate specialized `wrap()` functions that skip `isWrappable()` runtime checks using compile-time type knowledge.

```typescript
// Generic (current)
function wrap<T>(value: T): T {
  return isWrappable(value) ? createGrainProxy(value) : value;
}

// Generated for known nested type
function wrapNestedValue(value: { value: number }) {
  return createGrainProxy(value); // Known wrappable at compile time
}
```

**Expected improvement:** 5-15%.

### 4. MongoDB Operator Specialization

Generate optimized update functions for common operator patterns instead of runtime `switch` dispatching.

```typescript
function updateUserStore(target: UserStore, operations: UserStoreOperations) {
  if ("$set" in operations) {
    const setOps = operations.$set;
    if ("count" in setOps) setProperty(target, "count", setOps.count);
    if ("name" in setOps) setProperty(target, "name", setOps.name);
    if ("nested.value" in setOps) setProperty(target.nested, "value", setOps["nested.value"]);
  }

  if (hasOtherOperations(operations)) {
    return genericUpdate(target, operations);
  }
}
```

**Expected improvement:** 20-30%. Eliminates runtime operator parsing and switch overhead.

## Expected Combined Impact

| Optimization                 | Expected Improvement | Safety Level                        |
| ---------------------------- | -------------------- | ----------------------------------- |
| Proxy Handler Specialization | 15-25%               | High -- preserves all behavior      |
| Signal Pre-allocation        | 10-20%               | High -- same signals, pre-created   |
| Type-Aware Wrapping          | 5-15%                | High -- equivalent runtime behavior |
| Operator Specialization      | 20-30%               | High -- same operations, optimized  |

**Combined:** 30-60% improvement with 100% reactivity compatibility.

**Caveat:** These are estimates based on allocation analysis benchmarks, not measured results. The Vite plugin investigation (which pursued a subset of these ideas) found that proxy overhead was not the bottleneck it appeared to be in microbenchmarks.

## Implementation Strategy

### Phase 1: Babel Plugin for Shape Analysis

Identify `createStore` calls with type annotations; generate optimized handlers and pre-allocation factories.

### Phase 2: TypeScript Transformer

Use actual interface definitions via the TypeChecker API for deeper type analysis.

### Phase 3: Runtime Fallbacks

All optimized paths fall back to generic implementations for unknown patterns, dynamic access, and complex operations.

## Safety Guarantees

1. **Behavioral equivalence testing** -- generated test suites validate optimized vs. generic implementations
2. **Runtime validation mode** -- development builds compare optimized and generic results
3. **Progressive enhancement** -- optimizations only apply when safe; all existing APIs unchanged; zero breaking changes

## Compile-Time Analysis Requirements

- TypeScript interfaces for store shapes
- Property type analysis and nested object mapping
- Usage pattern detection (frequent properties, common operations, reactive vs. non-reactive contexts)
- Safety fallback: unknown/dynamic property access always uses generic path

## Implementation Timeline (Estimated)

| Phase                 | Duration  | Scope                                                                                  |
| --------------------- | --------- | -------------------------------------------------------------------------------------- |
| Foundation            | 2-3 weeks | Shape analysis, proxy handler codegen, basic TS transformer, validation framework      |
| Optimization Engine   | 2-3 weeks | Signal pre-allocation, type-aware wrapping, operator specialization, runtime fallbacks |
| Integration & Testing | 1-2 weeks | Babel plugin integration, benchmarks, safety testing, docs                             |

---

**Risk Level:** Low -- all optimizations preserve existing behavior
**Dependencies:** TypeScript transformer, Babel plugin infrastructure
**Validation Required:** Comprehensive reactivity contract testing
