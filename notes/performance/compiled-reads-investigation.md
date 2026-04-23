# Compiled Reads Investigation

> **TL;DR:** Goal was solid-js-level read performance. `readSignal` compilation failed (slower than proxy). Success came from two different mechanisms: `createView` prototype getters (10x faster reads via V8 inlining) and `$$()` direct DOM bindings (bypasses React reconciliation entirely, matches/beats solid-js).

**Date:** March 15-16, 2026
**Status:** Succeeded via alternative approaches (not the originally planned `readSignal`)

---

## Goal

Make supergrain store reads as fast as solid-js. The original hypothesis (from `notes/architecture/vite-compiler-plugin-plan.md`) was that a Vite plugin compiling `store.title` to `readSignal(store, 'title')()` would beat solid-js by 1.2-3x.

## What Was Tried

### Phase 1: readSignal Compilation -- FAILED

The Vite plugin used TypeScript's type checker to detect property reads on `Branded<T>` types and rewrite them:

```typescript
// Input:
store.user.address.city;

// Plugin output (nested compilation):
readSignal(readSignal(readSignal(store, "user"), "address"), "city");
```

**Bug 1 -- Dual-module imports:** The plugin added `import { readSignal } from '@supergrain/kernel'` but test files imported from `../src`. Two module instances meant two signal systems. Fix: plugin adds `readSignal` to the existing import source.

**Bug 2 -- readSignal returned raw values:** `readSignal` returned `node()` (the raw signal value). For nested objects, this broke tracking because raw objects have no signals. Fix: added `wrap(node())`, but this made readSignal do the same work as the proxy plus extra overhead.

**Benchmark result: slower than proxy.**

```
Reactive leaf reads:      proxy 472 hz, readSignal 267 hz (0.57x)
Component render 6 props: proxy 502 hz, readSignal 320 hz (0.64x)
Reactive updates:         proxy 3,552 hz, readSignal 3,350 hz (tied)
```

Root cause: readSignal does all the proxy's work + a function call + an extra proxy dispatch for `unwrap(target)`.

### Phase 2: readLeaf (skip wrap) -- FAILED

Created `readLeaf` that skips `wrap()` for primitive reads:

```typescript
export function readLeaf(target: any, prop: PropertyKey): any {
  const raw = (target as any)[$RAW] || target;
  const node = (raw as any)[$NODE]?.[prop];
  if (node) return node();
  return getNode(getNodes(raw as object), prop, (raw as any)[prop])();
}
```

**Result:** Still slower than proxy. Function call overhead alone negates any savings.

### Phase 3: Inline $NODE access -- FAILED

Plugin generates direct signal access instead of a function call:

```typescript
// Input:  store.title
// Output: store[$RAW][$NODE]['title']()
```

**Result:** `store[$RAW]` still goes through the proxy trap. One proxy dispatch per read, same as baseline.

**Key discovery:** Cached `$NODE` is 10x faster (`const nodes = raw[$NODE]; nodes['title']()` = 4,100 ops/s), but the plugin generates per-expression rewrites and can't hoist variable caching.

### Phase 4: Exhaustive Benchmark -- KEY FINDING

Tested 15 read patterns (all inside `effect()`, 100k iterations):

| Pattern                                  | ops/s     | vs Proxy         |
| ---------------------------------------- | --------- | ---------------- |
| Direct local signal: `sig()`             | 4,828     | 10.8x faster     |
| **Class prototype getter**: `view.title` | **4,474** | **10.0x faster** |
| Cached $NODE: `nodes['title']()`         | 4,176     | 9.3x faster      |
| String prop: `raw.__nodes['title']()`    | 4,137     | 9.2x faster      |
| Preact `.value` getter                   | 1,145     | 2.6x faster      |
| Object.defineProperty getter             | 1,142     | 2.6x faster      |
| Minimal 2-line function                  | 541       | 1.2x faster      |
| Proxy baseline                           | 447       | 1.0x             |
| readSignal(proxy)                        | 267       | 0.6x (slower)    |
| readLeaf(proxy)                          | 266       | 0.6x (slower)    |
| Inlined readSignal body                  | 178       | 0.4x (slower)    |

**Critical V8 insight:** V8 inlines class prototype getters but NOT function calls, `Object.defineProperty` getters on instances, or proxy traps. Dynamic prototype getters (via `Object.defineProperty` on a prototype) are just as fast as static class getters -- no compile-time class generation needed.

### Phase 5: createView -- SUCCEEDED (moderate gains)

Built `createView()` using prototype getters:

```typescript
export function createView<T extends object>(target: T): T {
  // Build prototype with getters (cached per key set)
  // Object.defineProperty on proto: get() { return this._n[key]() }
  // V8 inlines this!
  const view = Object.create(proto);
  view._n = nodes;
  return view as T;
}
```

**End-to-end results (React, chromium):**

```
Create 1000: proxy 69ms -> createView 61ms (1.1x faster)
Swap rows:   proxy 100ms -> createView 63ms (1.6x faster)
Partial:     proxy 68ms -> createView 53ms (1.3x faster)
```

Modest improvement because React reconciliation dominates total time.

### Phase 6: $$() Direct DOM -- SUCCEEDED (matches solid-js)

The breakthrough: bypass React's reconciliation entirely. Signal changes update DOM nodes directly.

```tsx
// User writes:
<a>{$$(item.label)}</a>

// Compiler generates:
const __$$0 = useRef(null)
useDirectBindings([{ ref: __$$0, getter: () => item.label }])
<a ref={__$$0}>{item.label}</a>

// At runtime: signal fires -> effect runs -> ref.textContent = newValue
// No React re-render, no VDOM diff
```

**Pitfall -- nested effect trap:** Creating 2000 effects inside a running outer effect was 5x slower (25ms vs 5ms). Fix: create effects synchronously outside any running effect.

**Pitfall -- act() benchmark artifact:** Initial benchmarks showed 25ms vs solid's 6ms. The gap was from React testing library's `act()` flushing the scheduler with 2000 live effects still attached. Moving `cleanup()` inside `act()` eliminated the artifact.

**Final results (chromium, verified by correctness tests):**

| Operation      | React Hooks | Proxy | createView | **Direct DOM $$** | **Solid-js** |
| -------------- | ----------- | ----- | ---------- | ----------------- | ------------ |
| Create 1000    | 53ms        | 69ms  | 61ms       | **3.2ms**         | 7.6ms        |
| Select         | 70ms        | 62ms  | 58ms       | **17ms**          | 6.9ms        |
| Swap           | 70ms        | 100ms | 63ms       | **7.5ms**         | 11.6ms       |
| Partial update | 64ms        | 68ms  | 53ms       | **12ms**          | 11ms         |

---

## Key Learnings

### V8 optimization hierarchy (reactive context, same signal)

1. Local variable signal call: ~4,800 ops/s
2. Class/prototype getter: ~4,100-4,500 ops/s (V8 inlines)
3. Cached $NODE lookup: ~4,100 ops/s
4. Object.defineProperty getter (on instance): ~1,100 ops/s
5. Minimal function call: ~540 ops/s
6. Proxy trap: ~450 ops/s
7. readSignal function: ~270 ops/s (SLOWER than proxy)

### Real bottlenecks (in order of impact)

1. **React reconciliation** -- re-executing components, diffing VDOM, committing DOM (~50-100ms for 1000 rows). Fixed by `$$()` direct DOM.
2. **Nested effect creation** -- 5x overhead from creating effects inside running effects (~20ms for 2000 effects). Fixed by building synchronously.
3. **Proxy overhead** -- ~8-10x slower than direct signal access. Fixed by prototype getters (`createView`).
4. **act() scheduler flush** -- testing artifact, not a production issue.

### What solid-js does differently

- Solid does NOT bypass its proxy -- reads still go through the store proxy at runtime
- Solid's speed comes from: component runs once (setup), DOM updates are direct (no VDOM), compiler wraps expressions in effects for lazy evaluation
- The key architectural difference: React re-executes components, solid doesn't

### The path that worked

1. Proxy for writes (unchanged, handles sub-tree replacement, array mutations)
2. `createView` for reads (prototype getters, V8 inlines, 1.1-1.6x over proxy)
3. `$$()` for hot paths (direct DOM, bypasses React, matches solid)
4. Schema-driven stores via ArkType (`createModelStore`, nested view prototypes)

### The path that didn't work

1. `readSignal` function calls (slower than proxy)
2. `readLeaf` without wrap (still slower)
3. Inlined `$NODE` access (proxy dispatch for `$RAW` negates savings)
4. Pre-allocating all signals eagerly (expensive, breaks on sub-tree replacement)
5. Switching to preact/signals-core (benchmarks were invalid -- not run in effect)

---

## File References

### Working code

- `packages/core/src/store.ts` -- createView, createModelStore, proxy fast path
- `packages/vite-plugin/src/plugin.ts` -- $$() JSX transformation
- `packages/react/src/use-direct-bindings.ts` -- useDirectBindings hook

### Benchmarks

- `packages/react/benchmarks/direct-dom.bench.tsx` -- 6-way comparison (the main benchmark)
- `packages/react/benchmarks/gap-analysis.bench.tsx` -- proved store is fast, React isn't the issue
- `packages/react/benchmarks/gap-detail.bench.tsx` -- proved act() was the artifact
- `packages/core/benchmarks/exhaustive-read-patterns.bench.ts` -- V8 optimization hierarchy
- `packages/core/benchmarks/getter-patterns.bench.ts` -- dynamic vs static getters

### Tests

- `packages/react/tests/direct-binding.test.tsx` -- $$() correctness
- `packages/react/tests/compiled-vs-proxy.test.tsx` -- 3-mode correctness
- `packages/react/tests/benchmark-correctness.test.tsx` -- all implementations produce correct DOM
- `packages/core/tests/model-store.test.ts` -- ArkType schema-driven store

### Failed approach docs

- `notes/failed-approaches/readSignal-function-call.md`
- `notes/failed-approaches/per-level-readSignal-compilation.md`
- `notes/failed-approaches/preact-signals-comparison.md`
- `notes/failed-approaches/nested-effect-creation.md`
- `notes/failed-approaches/eager-signal-preallocation.md`
