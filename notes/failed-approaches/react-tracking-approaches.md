# FAILED: React Store Tracking Approaches (7 of 8 attempts)

> **Status:** FAILED. 7 approaches to React-alien-signals integration failed before proxy-based isolation succeeded as `useTracked`.
>
> **Core constraint:** alien-signals only establishes dependencies when signals are accessed INSIDE an effect callback. React components access stores during render, which is OUTSIDE any effect callback. Every failed approach tried to work around this mismatch.

## The Fundamental Problem

```typescript
// DOESN'T WORK -- effect has no dependencies
const cleanup = effect(() => {
  /* empty callback */
});
setCurrentSub(effectInstance);
const value = store.property; // Outside effect callback -- not tracked!

// WORKS -- effect tracks dependencies
const cleanup = effect(() => {
  const value = store.property; // Inside callback -- tracked!
});
```

## Failed Approaches

### 1. Global subscriber during render

Set the component's effect as `currentSub` for the entire render.

**Why it failed:** React renders depth-first. Child calls `useStore()`, overwrites parent's subscriber. Parent continues with child's subscriber active — tracks wrong dependencies or loses tracking entirely.

### 2. Immediate context restoration (Promise.resolve)

Restore the previous subscriber via `Promise.resolve().then()` after render.

**Why it failed:** Render is synchronous. The microtask fires after the entire render tree completes, not after the individual component. By then, nested components have already corrupted the subscriber state.

### 3. Stack-based subscriber management

Push/pop subscribers on a stack to handle nesting.

**Why it failed:** Partially worked for simple cases, but React concurrent mode and error boundaries break the stack invariant. Interrupted renders leave stale entries; error boundaries skip the pop.

### 4. React Context for isolation

Use React Context to provide per-component tracking scopes.

**Why it failed:** Added significant complexity without solving the timing problem. Context propagation doesn't align with alien-signals' synchronous subscriber model.

### 5. Manual track function

Require explicit `track(() => store.x)` calls around every property access.

**Why it worked (but was rejected):** Functionally correct — wraps each access in a real effect callback. Rejected for poor DX. Writing `track(() => store.x)` for every property is verbose and error-prone.

### 6. Finish/restore pattern

Call `effectStore.finish()` at the end of render to restore previous subscriber.

**Why it failed:** `finish()` must be called at exactly the right time, but React doesn't expose a reliable "component render complete" hook. Fragile with concurrent rendering, Suspense, and error boundaries.

### 7. Effect with tracked callback (re-access pattern)

Record which properties the component accessed, then re-access them inside the effect callback to establish dependencies.

**Why it failed:** Can't predict which properties a component will access before it renders. Re-accessing after render means the effect runs twice per cycle. Added complexity and overhead without reliability.

## What Succeeded: Approach #8

**Proxy-based per-access subscriber swapping** — wrap each property access in a proxy that temporarily sets the correct subscriber for just that one read. See [../react-adapter/useTracked.md](../react-adapter/useTracked.md).

The key insight: instead of trying to make the entire render happen "inside" an effect, make each individual property access happen inside the correct tracking context. The subscriber swap is microsecond-precise and naturally handles nesting.

## Evolution

The full design evolution is documented in the react-adapter folder:

- [v2-initial-design.md](../react-adapter/v2-initial-design.md) — Preact-inspired architecture, discovered the alien-signals limitation
- [v3-tracking-discovery.md](../react-adapter/v3-tracking-discovery.md) — Isolated the core problem
- [v4-nested-components.md](../react-adapter/v4-nested-components.md) — Identified the nested component bug
- [useTracked.md](../react-adapter/useTracked.md) — The shipped solution
