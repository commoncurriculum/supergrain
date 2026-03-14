# Failed Optimization: Per-Level readSignal Compilation

**Date:** March 2026
**Optimization Attempted:** Vite plugin compiles `store.prop` reads to `readSignal(store, 'prop')` calls that bypass the proxy
**Result:** Equal or slower than proxy reads in all benchmarks
**Key Lesson:** Bypassing the proxy only helps if you also eliminate the work the proxy does. Replacing the proxy's get trap with equivalent JS function calls doesn't save anything — V8's Proxy internals are already fast.

## Background

The supergrain vite plugin (`@supergrain/vite-plugin`) uses TypeScript's type checker to detect property reads on `Branded<T>` types (stores created by `createStore`). It rewrites them to `readSignal()` calls:

```typescript
// Before (proxy mode)
store.user.address.city

// After (compiled mode)
readSignal(readSignal(readSignal(store, 'user'), 'address'), 'city')
```

The idea: skip the proxy's get trap overhead (symbol checks, function checks, subscriber checks) by going directly to the signal.

## What readSignal Does

```typescript
export function readSignal(target: any, prop: PropertyKey): any {
  const raw = unwrap(target)           // strip proxy wrapper
  const nodes = getNodes(raw as object) // get/create signal map
  const node = getNode(nodes, prop, raw[prop]) // get/create signal
  return wrap(node())                  // read signal + wrap objects in proxy
}
```

## Why It's Not Faster

### The proxy get trap does almost identical work

```typescript
// Proxy handler.get (simplified)
get(target, prop) {
  if (prop === $RAW) return target     // ← symbol checks readSignal skips
  if (prop === $PROXY) return receiver
  const value = target[prop]
  if (typeof value === 'function') return value  // ← function check readSignal skips
  const nodes = getNodes(target)       // same
  const node = getNode(nodes, prop, value) // same
  return wrap(node())                  // same
}
```

readSignal skips the symbol checks and function check, but adds `unwrap()` overhead. Net savings: approximately zero.

### wrap() is the real cost — both paths pay it

`wrap()` creates a reactive proxy for object/array values. Both the proxy get trap and `readSignal` call `wrap(node())`. This proxy creation dominates the cost of property reads. Compiling to `readSignal` doesn't eliminate it.

### Without wrap(), nested reads break

If `readSignal` returns raw (no proxy), then:

```typescript
readSignal(store, 'departments')[0].name  // [0] returns raw, .name is untracked!
```

Bracket access (`[0]`), destructuring, and spread can't be compiled (they're not PropertyAccessExpression). The proxy is needed at these boundaries.

## Benchmark Results

Ran on the `proxy` vitest project (no plugin transformation) so both paths execute their actual code:

| Scenario | Proxy (hz) | Compiled (hz) | Ratio |
|----------|-----------|---------------|-------|
| Non-reactive leaf reads (1M) | 47.6 | 25.9 | proxy 1.8x faster |
| Non-reactive nested reads (1M) | 18.8 | 10.4 | proxy 1.8x faster |
| Reactive leaf reads (100k) | 236.5 | 151.8 | proxy 1.6x faster |
| Reactive updates (1k mutations) | 3,301 | 3,015 | proxy 1.1x faster |
| Component render (8 props, 10k) | 372.6 | 141.1 | proxy 2.6x faster |
| Batched updates (5 fields, 1k) | 809 | 738 | proxy 1.1x faster |

Compiled is slower in every scenario.

## What the Prototype Got Right

The earlier prototype benchmarks (`packages/core/prototype/compiled-reads.bench.ts`, now deleted) showed compiled reads being 2-4x faster than proxy. That prototype used a fundamentally different architecture:

```typescript
// Prototype: flat pre-allocated signal map
const signals = store[$SIGNALS]
const title = signals.title()        // single hash lookup, no proxy, no wrap
const name = signals['assignee.name']() // flat key, pre-allocated
```

Key differences from the per-level approach:
1. **Flat signal map** — `'assignee.name'` is a single key, not two levels of readSignal
2. **Pre-allocated signals** — created at store init from schema, not lazily
3. **No wrap()** — returns raw values; the schema knows the shape, no proxy needed
4. **No unwrap()** — operates on raw objects directly

## What Would Actually Work

### Option A: Flat path compilation

The plugin flattens chained reads into a single signal lookup:

```typescript
// store.user.address.city
// compiles to:
readFlat(store, 'user.address.city')  // single hash lookup on pre-built signal map
```

Requires: pre-allocating signals for all known paths at `createStore` time (needs schema info or first-access registration).

### Option B: Schema-driven signal pre-allocation

Like the prototype's `model()` approach but integrated with `createStore`:

```typescript
const [store] = createStore(initialData, { schema: MyType })
// All signals pre-allocated from schema
// Plugin compiles reads to direct signal access
```

### Option C: Compile-time signal map generation

The plugin generates a typed signal map alongside the store:

```typescript
// Plugin output:
const [store, update] = createStore({ user: { name: 'Scott' } })
const __signals = {
  user: readSignal(store, 'user'),
  'user.name': readSignal(store.user, 'name'),
}
// Reads become:
const name = __signals['user.name']  // pre-resolved, cached
```

### Option D: Accept proxy for reads, optimize elsewhere

The proxy is already fast for reads. The real performance opportunity might be elsewhere:
- Reducing effect re-execution overhead
- Smarter batching
- Eliminating unnecessary wrap() calls for primitive values (the proxy already handles this, but there may be room for specialization)

## Files Changed (then reverted/preserved as benchmarks)

- `packages/core/src/store.ts` — `readSignal` with `wrap()` and typed overload
- `packages/vite-plugin/src/plugin.ts` — nested readSignal compilation, smart import injection
- `packages/core/benchmarks/compiled-comparison.bench.ts` — benchmark capturing these results
- `packages/core/vitest.config.ts` — proxy + compiled test parameterization (this is still valuable even though perf didn't improve)

## Key Takeaway

The parameterized tests (running every test in both proxy and compiled mode) proved their value — they caught real bugs (dual-module import issue, missing `wrap()` for nested objects). But the compilation itself doesn't speed up reads because both paths do the same fundamental work: signal lookup + proxy creation. A different architecture (flat signal maps, pre-allocation) is needed for compiled reads to outperform the proxy.
