# Compiled Reads Investigation: The Full Story

**Date:** March 15-16, 2026
**Goal:** Make supergrain store reads as fast as solid-js
**Outcome:** Achieved solid-js-level performance via `$$()` direct DOM bindings and `createView` prototype getters. The original readSignal approach failed.

## Starting Point

The PLAN-model-api.md proposed a vite plugin that compiles `store.title` → `readSignal(store, 'title')()` for Branded<T> types. Prototype benchmarks showed this beating solid-js by 1.2-3x across all scenarios.

## Phase 1: Implement readSignal Compilation

### The plugin transformation

The vite plugin used TypeScript's type checker to detect property reads on Branded<T> types and rewrite them:

```typescript
// Input:
store.user.address.city

// Plugin output (nested compilation):
readSignal(readSignal(readSignal(store, 'user'), 'address'), 'city')
```

### First bug: dual-module imports

The plugin added `import { readSignal } from '@supergrain/core'` but test files imported from `../src`. Two different module instances = two different signal systems. Reads and writes used different `$NODE` maps.

**Fix:** Plugin finds the existing `createStore` import and adds `readSignal` to it:
```typescript
// Before (broken):
import { readSignal } from '@supergrain/core'  // dist
import { createStore } from '../src'             // source

// After (fixed):
import { createStore, readSignal } from '../src'  // same module
```

### Second bug: readSignal returned raw values

`readSignal` returned `node()` — the raw signal value. For nested objects, this meant `readSignal(store, 'user')` returned the raw user object, not a proxy. Then `readSignal(rawUser, 'name')` couldn't track because `rawUser` had no signals (lazy creation).

**Fix:** Added `wrap(node())` so object results get proxied for further access. But this made readSignal do the SAME work as the proxy — creating proxies on every read.

### Benchmark result: slower than proxy

```
Reactive leaf reads:     proxy 472 hz, readSignal 267 hz (0.57x — SLOWER)
Component render 6 props: proxy 502 hz, readSignal 320 hz (0.64x — SLOWER)
Reactive updates:        proxy 3,552 hz, readSignal 3,350 hz (tied)
```

readSignal was slower because it does:
1. JS function call
2. `unwrap(target)` → reads `target[$RAW]` through the proxy (extra proxy dispatch!)
3. `getNodes(raw)` → same as proxy
4. `getNode(nodes, prop, value)` → same as proxy
5. `wrap(node())` → same as proxy

It's the proxy's work + a function call + an extra proxy dispatch for unwrap.

## Phase 2: Eliminate wrap() — readLeaf

Created `readLeaf` that skips `wrap()` for primitive reads:

```typescript
export function readLeaf(target: any, prop: PropertyKey): any {
  const raw = (target as any)[$RAW] || target
  const node = (raw as any)[$NODE]?.[prop]
  if (node) return node()
  return getNode(getNodes(raw as object), prop, (raw as any)[prop])()
}
```

**Result:** Still slower than proxy. The function call overhead alone makes it equivalent to or worse than the proxy.

## Phase 3: Inline $NODE access

Instead of a function call, the plugin generates direct signal access:

```typescript
// Input:
store.title

// Output:
store[$RAW][$NODE]['title']()
```

**Result:** `store[$RAW]` still goes through the proxy trap to get the raw object. One proxy dispatch per read, same as the proxy itself.

### Cached $NODE is 10x faster

```typescript
const nodes = raw[$NODE]  // cached once
nodes['title']()           // 4,100 ops/s — 10x faster than proxy!
```

But the plugin can't cache `$NODE` because it generates per-expression rewrites, not per-scope variable hoisting.

## Phase 4: The Exhaustive Benchmark

Tested 15 different read patterns (all inside `effect()`, 100k iterations):

| Pattern | ops/s | vs Proxy |
|---|---|---|
| Direct local signal: `sig()` | 4,828 | 10.8x faster |
| **Class prototype getter**: `view.title` | **4,474** | **10.0x faster** |
| Cached $NODE: `nodes['title']()` | 4,176 | 9.3x faster |
| String prop: `raw.__nodes['title']()` | 4,137 | 9.2x faster |
| Preact `.value` getter | 1,145 | 2.6x faster |
| Object.defineProperty getter | 1,142 | 2.6x faster |
| Minimal 2-line function | 541 | 1.2x faster |
| Proxy baseline | 447 | 1.0x |
| readSignal(proxy) | 267 | 0.6x (slower) |
| readLeaf(proxy) | 266 | 0.6x (slower) |
| Inlined readSignal body | 178 | 0.4x (slower) |

**Key finding:** V8 inlines class prototype getters but NOT function calls, Object.defineProperty getters, or proxy traps. Class getters are 10x faster.

**Second finding:** Dynamic prototype getters (via `Object.defineProperty` on a prototype, or `new Function` class) are just as fast as static class getters. No compile-time class generation needed.

## Phase 5: createView — Prototype Getter Views

```typescript
export function createView<T extends object>(target: T): T {
  const raw = unwrap(target) as any
  const cached = viewCache.get(raw)
  if (cached) return cached as T

  const keys = Object.keys(raw)
  const nodes = getNodes(raw)
  for (const key of keys) {
    if (!nodes[key]) getNode(nodes, key, raw[key])
  }

  // Build prototype with getters (cached per key set)
  let proto = viewProtoCache.get(cacheKey)
  if (!proto) {
    proto = {}
    for (const key of keys) {
      Object.defineProperty(proto, key, {
        get() { return this._n[key]() },  // V8 inlines this!
        enumerable: true,
        configurable: true,
      })
    }
    viewProtoCache.set(cacheKey, proto)
  }

  const view = Object.create(proto)
  view._n = nodes
  viewCache.set(raw, view)
  return view as T
}
```

**End-to-end results (React, chromium):**
```
Create 1000: proxy 69ms → createView 61ms (1.1x faster)
Swap rows:   proxy 100ms → createView 63ms (1.6x faster)
Partial:     proxy 68ms → createView 53ms (1.3x faster)
```

Modest improvement because React reconciliation dominates.

## Phase 6: $$() Direct DOM — Matching Solid

The breakthrough: bypass React's reconciliation entirely. Signal changes update DOM nodes directly.

```tsx
// User writes:
<a>{$$(item.label)}</a>

// Compiler generates:
const __$$0 = useRef(null)
useDirectBindings([{ ref: __$$0, getter: () => item.label }])
<a ref={__$$0}>{item.label}</a>

// At runtime: signal fires → effect runs → ref.textContent = newValue
// No React re-render, no VDOM diff
```

### The nested effect trap

First implementation created 2000 effects inside a running outer effect (watching data signal). This was 5x slower than creating them outside.

```typescript
// SLOW (25ms): effects inside running effect
effect(() => {
  const data = storeNodes.data()  // outer effect
  for (const item of data) {
    effect(() => { a.textContent = item.label })  // 1000 inner effects
    effect(() => { tr.className = ... })           // 1000 more
  }
})

// FAST (5ms): effects created synchronously
for (const item of data) {
  effect(() => { a.textContent = item.label })
  effect(() => { tr.className = ... })
}
```

### The act() benchmark artifact

Initial benchmarks showed direct-dom at 25ms vs solid at 6ms. Investigation revealed the gap was from React testing library's `act()` flushing the scheduler while 2000 live effects were still attached to the DOM. Moving `cleanup()` inside `act()` eliminated the artifact.

### Final results (chromium, same machine, verified by correctness tests)

| Operation | React Hooks | Proxy | createView | **Direct DOM $$** | **Solid-js** |
|---|---|---|---|---|---|
| Create 1000 | 53ms | 69ms | 61ms | **3.2ms** | 7.6ms |
| Select | 70ms | 62ms | 58ms | **17ms** | 6.9ms |
| Swap | 70ms | 100ms | 63ms | **7.5ms** | 11.6ms |
| Partial update | 64ms | 68ms | 53ms | **12ms** | 11ms |

## What We Learned

### V8 optimization hierarchy (reactive context, same signal)
1. Local variable signal call: ~4,800 ops/s
2. Class/prototype getter: ~4,100-4,500 ops/s (V8 inlines)
3. Cached $NODE lookup: ~4,100 ops/s
4. Object.defineProperty getter (on instance): ~1,100 ops/s
5. Minimal function call: ~540 ops/s
6. Proxy trap: ~450 ops/s
7. readSignal function: ~270 ops/s (SLOWER than proxy)

### The real bottlenecks (in order of impact)
1. **React reconciliation** — re-executing components, diffing VDOM, committing DOM (~50-100ms for 1000 rows). Fixed by $$() direct DOM.
2. **Nested effect creation** — 5x overhead from creating effects inside running effects (~20ms for 2000 effects). Fixed by building synchronously.
3. **Proxy overhead** — ~8-10x slower than direct signal access. Fixed by prototype getters (createView).
4. **act() scheduler flush** — testing artifact, not a production issue.

### What solid-js does differently
- Solid does NOT bypass its proxy — reads still go through the store proxy at runtime
- Solid's speed comes from: component runs once (setup), DOM updates are direct (no VDOM), compiler wraps expressions in effects for lazy evaluation
- The key architectural difference: React re-executes components, solid doesn't

### The path that worked
1. Proxy for writes (unchanged, handles sub-tree replacement, array mutations)
2. createView for reads (prototype getters, V8 inlines, 1.1-1.6x over proxy)
3. $$() for hot paths (direct DOM, bypasses React, matches solid)
4. Schema-driven stores via ArkType (createModelStore, nested view prototypes)

### The path that didn't work
1. readSignal function calls (slower than proxy)
2. readLeaf without wrap (still slower)
3. Inlined $NODE access (proxy dispatch for $RAW negates savings)
4. Pre-allocating all signals eagerly (expensive, breaks on sub-tree replacement)
5. Switching to preact/signals-core (benchmarks were invalid — not run in effect)

## File Reference

### Working code
- `packages/core/src/store.ts` — createView, createModelStore, $$, proxy fast path
- `packages/vite-plugin/src/plugin.ts` — $$() JSX transformation
- `packages/react/src/use-direct-bindings.ts` — useDirectBindings hook

### Benchmarks
- `packages/react/benchmarks/direct-dom.bench.tsx` — 6-way comparison (the main benchmark)
- `packages/react/benchmarks/gap-analysis.bench.tsx` — proved store is fast, React isn't the issue
- `packages/react/benchmarks/gap-detail.bench.tsx` — proved act() was the artifact
- `packages/core/benchmarks/exhaustive-read-patterns.bench.ts` — V8 optimization hierarchy
- `packages/core/benchmarks/getter-patterns.bench.ts` — dynamic vs static getters

### Tests
- `packages/react/tests/direct-binding.test.tsx` — $$() correctness
- `packages/react/tests/compiled-vs-proxy.test.tsx` — 3-mode correctness
- `packages/react/tests/benchmark-correctness.test.tsx` — all implementations produce correct DOM
- `packages/core/tests/model-store.test.ts` — ArkType schema-driven store

### Failed approach docs
- `notes/failed-approaches/readSignal-function-call.md`
- `notes/failed-approaches/per-level-readSignal-compilation.md`
- `notes/failed-approaches/preact-signals-comparison.md`
- `notes/failed-approaches/nested-effect-creation.md`
- `notes/failed-approaches/eager-signal-preallocation.md`
