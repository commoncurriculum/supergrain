# Failed Approach: Switching to Preact Signals for Faster Reads

**Date:** March 2026
**Approach:** Switch from alien-signals to @preact/signals-core because benchmarks showed preact 2-4x faster on reads
**Result:** The benchmarks were invalid — preact was not tested inside a reactive context
**Key Lesson:** Always benchmark signal libraries inside an `effect()`. Without reactive tracking, you're measuring property access speed, not signal performance.

## The Invalid Benchmarks

Versions: alien-signals 2.0.7, @preact/signals-core 1.14.0

| Benchmark | alien-signals | preact | Apparent Winner |
|-----------|------------:|-------:|--------|
| Single signal read (100k) | 1,519 ops/s | 4,608 ops/s | preact 3.0x |
| Multiple signals (10×10k) | 1,059 ops/s | 4,085 ops/s | preact 3.9x |
| 10-deep computed chain (100k) | 1,477 ops/s | 3,136 ops/s | preact 2.1x |
| Propagation (100 effects, 1k) | 439 ops/s | 389 ops/s | alien 1.13x |

These numbers led to the suggestion that supergrain should switch to preact/signals-core for a 2-4x read speedup.

## Why the Benchmarks Were Wrong

The preact signal reads were **not run inside an `effect()`**. Without a reactive tracking context:

- **Preact `signal.value`**: Just returns `this._value` — a single property access, no tracking overhead
- **Alien-signals `signal()`**: Also just returns the value, but the function call has slightly more overhead than a property getter

The 2-4x "advantage" was measuring **V8's optimization of property getters vs function calls**, not signal library performance. In a real reactive context (inside an effect), both libraries do tracking work that dominates the read cost.

## What We Actually Found

When we benchmarked properly (all reads inside `effect()`), the signal library choice made negligible difference. The real bottlenecks were:

1. **Proxy overhead**: ~8-10x slower than direct signal access (fixed with `createView` prototype getters)
2. **React reconciliation**: ~10-15x slower than direct DOM updates (fixed with `$$()` direct DOM bindings)
3. **Nested effect creation**: ~5x overhead when creating effects inside a running effect (fixed by building rows synchronously)

The supergrain store + alien-signals runs at **~5ms for 1000 rows** — matching solid-js at ~6ms. The signal library was never the bottleneck.

## How to Properly Benchmark Signal Libraries

```typescript
// WRONG — no reactive context, measures getter vs function call
bench('preact', () => { for (let i = 0; i < 100_000; i++) sig.value })
bench('alien', () => { for (let i = 0; i < 100_000; i++) sig() })

// RIGHT — inside effect, with reactive tracking
bench('preact', () => {
  const dispose = preactEffect(() => {
    for (let i = 0; i < 100_000; i++) sig.value
  })
  dispose()
})
bench('alien', () => {
  const dispose = alienEffect(() => {
    for (let i = 0; i < 100_000; i++) sig()
  })
  dispose()
})
```

## Recommendation

Do not switch signal libraries based on micro-benchmarks. The signal read cost is a tiny fraction of end-to-end render time. Focus on:
- Reducing proxy overhead (createView, prototype getters)
- Bypassing React reconciliation ($$() direct DOM)
- Avoiding nested effect creation patterns
