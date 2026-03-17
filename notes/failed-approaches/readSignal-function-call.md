# FAILED: readSignal() Function Call for Compiled Reads

> **Status:** FAILED — Slower than proxy in every benchmark
> **Date:** March 2026
> **TL;DR:** Compiling `store.prop` to `readSignal(store, 'prop')` to bypass the proxy is 0.57-0.94x the speed of the proxy. The function does the same work as the proxy get trap (unwrap, signal lookup, wrap) but adds JS function call overhead and an `unwrap()` that itself triggers a proxy dispatch. No work is saved.

## Goal

Use the Vite plugin to compile store property reads into `readSignal()` calls that bypass the proxy's get trap.

## What Was Tried

```typescript
export function readSignal(target: any, prop: PropertyKey): any {
  const raw = unwrap(target)
  const nodes = getNodes(raw)
  const node = getNode(nodes, prop, raw[prop])
  return wrap(node())
}
```

This does the same work as the proxy get trap: unwrap -> get nodes -> get signal -> read -> wrap. Plus JS function call overhead.

## Benchmark Results

| Scenario | Proxy | readSignal | readSignal vs Proxy |
|---|---|---|---|
| Reactive leaf reads (100k) | 472 hz | 267 hz | **0.57x (slower)** |
| Component render (6 props) | 502 hz | 320 hz | **0.64x (slower)** |
| Reactive updates | 3,552 hz | 3,350 hz | 0.94x (tied) |

## Why It Failed

1. **JS function call overhead:** The proxy trap is dispatched by V8's native C++ runtime. An equivalent JS function goes through V8's generic call path, adding overhead.

2. **`unwrap()` triggers proxy dispatch:** `readSignal(store, 'prop')` calls `unwrap(store)` which reads `store[$RAW]` — going through the proxy trap to get the raw object. So you get proxy overhead PLUS function call overhead.

3. **`wrap()` recreates what the proxy already does:** Both the proxy's get trap and readSignal call `wrap(node())`. No work is saved.

## Variations Tried

- **`readLeaf()`** — skip `wrap()` for primitives. Still slower (function call overhead).
- **Inlined `store[$RAW][$NODE]['prop']()`** — 10x faster for cached `$NODE`, but each `$RAW` access still dispatches through proxy.
- **Nested compilation `readSignal(readSignal(store, 'user'), 'name')`** — MORE proxy work than `store.user.name` because each level does `unwrap()`.

## What Works Instead

- **Prototype getters** (`createView`) — V8 inlines prototype getters, avoiding function calls in the hot path.
- **Direct DOM bindings** (`$$()`) — bypasses React entirely.

## Key Learnings

- V8 cannot inline JS function calls in reactive contexts the same way it optimizes proxy traps. Any function doing the same work as a proxy trap will be slower.
- The only way compiled reads can beat the proxy is by doing fundamentally less work (e.g., flat signal maps, no `wrap()`, no `unwrap()`).
- See also: `per-level-readSignal-compilation.md` for the broader investigation including the prototype that DID work (different architecture).
