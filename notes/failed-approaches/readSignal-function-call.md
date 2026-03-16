# Failed Approach: readSignal() Function Call for Compiled Reads

**Date:** March 2026
**Approach:** Vite plugin compiles `store.prop` → `readSignal(store, 'prop')` to bypass proxy
**Result:** Slower than the proxy in every benchmark
**Key Lesson:** V8 cannot inline JS function calls in reactive contexts. Any function that does the same work as a proxy trap will be slower due to JS call overhead on top of the same signal machinery.

## What readSignal Does

```typescript
export function readSignal(target: any, prop: PropertyKey): any {
  const raw = unwrap(target)
  const nodes = getNodes(raw)
  const node = getNode(nodes, prop, raw[prop])
  return wrap(node())
}
```

This does the same work as the proxy get trap: unwrap → get nodes → get signal → read → wrap. Plus the overhead of a JS function call.

## Benchmark Results

| Scenario | Proxy | readSignal | readSignal vs Proxy |
|---|---|---|---|
| Reactive leaf reads (100k) | 472 hz | 267 hz | **0.57x (slower)** |
| Component render (6 props) | 502 hz | 320 hz | **0.64x (slower)** |
| Reactive updates | 3,552 hz | 3,350 hz | 0.94x (tied) |

## Why It Failed

1. **V8 can't inline the function call**: The proxy trap is dispatched by V8's native C++ runtime. A JS function doing equivalent work goes through V8's generic call path, which adds overhead.

2. **unwrap() triggers a proxy dispatch**: `readSignal(store, 'prop')` calls `unwrap(store)` which reads `store[$RAW]` — going through the proxy trap just to get the raw object. So you get proxy overhead PLUS function call overhead.

3. **wrap() recreates what the proxy already does**: The proxy's get trap returns `wrap(node())`. readSignal does the same. No work is saved.

## Variations Tried

- `readLeaf()` — skip wrap() for primitives. Still slower (function call overhead).
- Inlined `store[$RAW][$NODE]['prop']()` — 10x faster for cached $NODE, but each `$RAW` access still dispatches through proxy.
- Nested compilation `readSignal(readSignal(store, 'user'), 'name')` — MORE proxy work than `store.user.name` because each level does unwrap.

## What Actually Works

Prototype getters (createView) and direct DOM bindings ($$()). Both avoid function calls in the hot path — V8 inlines prototype getters, and $$() bypasses React entirely.
