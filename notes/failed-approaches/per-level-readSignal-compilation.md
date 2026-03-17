# FAILED: Per-Level readSignal Compilation

> **Status:** FAILED — Slower than proxy in every benchmark
> **Date:** March 2026
> **TL;DR:** Compiling `store.user.address.city` to nested `readSignal(readSignal(readSignal(store, 'user'), 'address'), 'city')` calls is 1.1-2.6x slower than the proxy. Both paths do the same work (signal lookup + `wrap()` proxy creation), but `readSignal` adds JS function call overhead and an extra `unwrap()` per level.

## Goal

Use the Vite plugin to compile property reads on `Branded<T>` store types into `readSignal()` calls that bypass the proxy's get trap, eliminating symbol checks, function checks, and subscriber checks.

## What Was Tried

The Vite plugin (`@supergrain/vite-plugin`) uses TypeScript's type checker to detect property reads and rewrites them:

```typescript
// Before (proxy mode)
store.user.address.city

// After (compiled mode)
readSignal(readSignal(readSignal(store, 'user'), 'address'), 'city')
```

### readSignal implementation

```typescript
export function readSignal(target: any, prop: PropertyKey): any {
  const raw = unwrap(target)           // strip proxy wrapper
  const nodes = getNodes(raw as object) // get/create signal map
  const node = getNode(nodes, prop, raw[prop]) // get/create signal
  return wrap(node())                  // read signal + wrap objects in proxy
}
```

## Why It Failed

### The proxy get trap does almost identical work

```typescript
// Proxy handler.get (simplified)
get(target, prop) {
  if (prop === $RAW) return target       // symbol checks readSignal skips
  if (prop === $PROXY) return receiver
  const value = target[prop]
  if (typeof value === 'function') return value  // function check readSignal skips
  const nodes = getNodes(target)         // same
  const node = getNode(nodes, prop, value) // same
  return wrap(node())                    // same
}
```

readSignal skips the symbol/function checks but adds `unwrap()` overhead. Net savings: approximately zero.

### `wrap()` is the real cost — both paths pay it

`wrap()` creates a reactive proxy for object/array values. Both paths call `wrap(node())`. This proxy creation dominates the cost of property reads. Compilation doesn't eliminate it.

### `unwrap()` triggers a proxy dispatch

`readSignal(store, 'prop')` calls `unwrap(store)` which reads `store[$RAW]` — going through the proxy trap just to get the raw object. So you get proxy overhead PLUS function call overhead.

### Without `wrap()`, nested reads break

If `readSignal` returns raw (no proxy):

```typescript
readSignal(store, 'departments')[0].name  // [0] returns raw, .name is untracked!
```

Bracket access, destructuring, and spread can't be compiled (they're not PropertyAccessExpression). The proxy is needed at these boundaries.

## Benchmark Results

| Scenario | Proxy (hz) | Compiled (hz) | Ratio |
|---|---:|---:|---|
| Non-reactive leaf reads (1M) | 47.6 | 25.9 | proxy 1.8x faster |
| Non-reactive nested reads (1M) | 18.8 | 10.4 | proxy 1.8x faster |
| Reactive leaf reads (100k) | 236.5 | 151.8 | proxy 1.6x faster |
| Reactive updates (1k mutations) | 3,301 | 3,015 | proxy 1.1x faster |
| Component render (8 props, 10k) | 372.6 | 141.1 | proxy 2.6x faster |
| Batched updates (5 fields, 1k) | 809 | 738 | proxy 1.1x faster |

Compiled is slower in every scenario.

## Why the Prototype Was Different

Earlier prototype benchmarks (`packages/core/prototype/compiled-reads.bench.ts`, now deleted) showed compiled reads 2-4x faster. That prototype used a fundamentally different architecture:

```typescript
// Prototype: flat pre-allocated signal map
const signals = store[$SIGNALS]
const title = signals.title()           // single hash lookup, no proxy, no wrap
const name = signals['assignee.name']() // flat key, pre-allocated
```

Key differences:
1. **Flat signal map** — `'assignee.name'` is a single key, not two levels of readSignal
2. **Pre-allocated signals** — created at store init from schema, not lazily
3. **No `wrap()`** — returns raw values; schema knows the shape
4. **No `unwrap()`** — operates on raw objects directly

## What Would Actually Work

### Option A: Flat path compilation
Flatten chained reads into a single signal lookup:
```typescript
readFlat(store, 'user.address.city')  // single hash lookup on pre-built signal map
```
Requires pre-allocating signals for all known paths at `createStore` time.

### Option B: Schema-driven signal pre-allocation
Like the prototype's `model()` approach but integrated with `createStore`:
```typescript
const [store] = createStore(initialData, { schema: MyType })
```

### Option C: Compile-time signal map generation
Plugin generates a typed signal map alongside the store.

### Option D: Accept proxy for reads, optimize elsewhere
The proxy is already fast for reads. Focus on reducing effect re-execution overhead, smarter batching, or eliminating unnecessary `wrap()` calls for primitives.

## Key Learnings

- Bypassing the proxy only helps if you also eliminate the work the proxy does. Replacing proxy dispatch with equivalent JS function calls doesn't save anything.
- `wrap()` (proxy creation for nested objects) dominates read cost. Any approach that still calls `wrap()` won't be faster.
- The parameterized tests (running every test in both proxy and compiled mode) caught real bugs (dual-module import issue, missing `wrap()` for nested objects) even though performance didn't improve.
- A different architecture (flat signal maps, pre-allocation) is needed for compiled reads to outperform the proxy.

## Files Changed (then reverted/preserved as benchmarks)

- `packages/core/src/store.ts` — `readSignal` with `wrap()` and typed overload
- `packages/vite-plugin/src/plugin.ts` — nested readSignal compilation, smart import injection
- `packages/core/benchmarks/compiled-comparison.bench.ts` — benchmark capturing these results
- `packages/core/vitest.config.ts` — proxy + compiled test parameterization
