# Path to 10x: How to Make Supergrain as Fast as Solid

## The Real Picture

### Why Solid is fast
Solid's speed does NOT come from bypassing the proxy. **Solid's store reads still go through the proxy at runtime.** The compiler wraps reads in arrow functions (`() => store.count`) for lazy evaluation inside effects, but the proxy is still there.

Solid is fast because:
1. **Component functions run once** (setup), not on every update
2. **DOM updates are direct** — `createRenderEffect` updates a specific text node, no VDOM diffing
3. **Solid's proxy has a fast path** — on repeat reads, it's 3 operations instead of supergrain's ~13

### Why React is the bottleneck
React re-executes the entire component function on every state change. Even with perfect store reads, you pay: function re-execution → VDOM creation → VDOM diff → DOM patch. No store optimization eliminates this. Solid skips all of it.

### What CAN be optimized in React
1. **Minimize WHICH components re-render** — supergrain's `useTracked` already does this
2. **Minimize the cost of reads DURING re-render** — this is where the 10x opportunity is

## Two Independent Optimizations

### 1. Optimize the proxy trap (immediate, low risk, ~2-4x)

Solid's proxy has a fast path that supergrain's doesn't:

```typescript
// Solid's get trap (simplified hot path):
get(target, property) {
  const nodes = getNodes(target);
  const tracked = nodes[property];
  if (tracked) return isWrappable(tracked()) ? wrap(tracked()) : tracked();
  // ... slow path for first read ...
}
```

On repeat reads (the common case), Solid does 3 operations: node lookup → signal call → return.

Supergrain's get trap always does ~13 operations:
```
$RAW check → $PROXY check → $TRACK check → $VERSION check → read value →
typeof function check → getCurrentSub check → getNodes → getNode → wrap(node())
```

**Fix: Add the fast path before symbol checks.** Symbols are rarely accessed (only by internal machinery). Check for an existing signal first:

```typescript
get(target, prop, receiver) {
  // FAST PATH: already-tracked property (the common case)
  const existingNodes = (target as any)[$NODE]
  if (existingNodes) {
    const tracked = existingNodes[prop]
    if (tracked) {
      const v = tracked()
      return isWrappable(v) ? createReactiveProxy(v) : v
    }
  }
  // Slow path: symbol checks, first-time reads, functions
  if (prop === $RAW) return target
  // ... rest of existing handler
}
```

This is safe because: symbol properties (`$RAW`, etc.) are never in the `$NODE` map, so the fast path correctly skips them. Functions are also not in `$NODE`. The fast path only fires for properties that have already been read at least once (signal exists).

### 2. Class getter view objects (compiler, 10x)

**The breakthrough finding from benchmarking:** V8 inlines class prototype getters to near-bare-signal speed. Function calls, Object.defineProperty getters, and proxy traps cannot be inlined.

| Pattern | ops/s | vs Proxy |
|---------|-------|----------|
| `titleSignal()` — direct local var | 4,828 | 10.8x faster |
| **Class getter** — `view.title` | **4,474** | **10.0x faster** |
| Cached $NODE — `nodes['title']()` | 4,176 | 9.3x faster |
| Object.defineProperty getter | 1,142 | 2.6x faster |
| Minimal function call | 541 | 1.2x faster |
| Proxy baseline | 447 | 1.0x |
| readSignal function | 267 | 0.6x (slower!) |

**Why class getters work:** V8 treats `class Foo { get x() { ... } }` as a stable hidden class with a known getter. TurboFan can inline the getter body after a few calls. Proxy traps and regular function calls go through V8's generic call path, which can't be inlined.

**Note:** Earlier benchmarks suggested preact signals were 2-4x faster than alien-signals on reads, but those benchmarks were not run inside an effect (no reactive tracking context). The comparison was invalid — preact was just returning `this._value` without tracking overhead. The class getter finding is based on our own benchmarks with proper reactive context.

#### How to implement

The compiler generates a view class for each store type:

```typescript
// For type { title: string, count: number, user: { name: string } }
class AppStateView {
  private _n: any  // cached $NODE reference

  constructor(raw: any) {
    const nodes = raw[$NODE] || (Object.defineProperty(raw, $NODE,
      { value: {}, enumerable: false, configurable: true }), raw[$NODE])
    // Pre-allocate signals for known properties
    if (!nodes['title']) nodes['title'] = signal(raw.title)
    if (!nodes['count']) nodes['count'] = signal(raw.count)
    if (!nodes['user']) nodes['user'] = signal(raw.user)
    this._n = nodes
  }

  get title(): string { return this._n.title() }
  get count(): number { return this._n.count() }
  get user(): UserView { /* return cached nested view */ }
}
```

Each getter is branch-free in the hot path: one property lookup on `this._n`, one signal call. V8 inlines this to ~4,400 ops/s.

**Pre-allocation happens in the constructor**, not at `createStore` time. The view is created when a component first reads the store. Signal creation is O(properties of this type), not O(entire document). Sub-tree replacement works because a new view is created for the new object.

#### React integration

```tsx
// useCompiled returns a cached view instance
function useCompiled<T>(store: T, ViewClass: new(raw: any) => any) {
  // ... effect setup (same as current useCompiled) ...
  // Cache view per raw object
  const raw = store[$RAW] || store
  if (!stateRef.current.view || stateRef.current.raw !== raw) {
    stateRef.current.view = new ViewClass(raw)
    stateRef.current.raw = raw
  }
  return stateRef.current.view
}

// Component:
function TodoItem({ item }: { item: Branded<RowData> }) {
  const view = useCompiled(item, RowDataView)
  return <div>{view.id} {view.label}</div>  // class getter reads, 10x faster
}
```

#### What the compiler generates

For each distinct `Branded<T>` type used in a component, the compiler:
1. Generates a view class (once, at the top of the module)
2. Replaces `useTracked(store)` with `useCompiled(store, ViewClass)`
3. Property reads `state.title` become `view.title` (getter calls, not proxy reads)

The proxy still exists for writes (`store.title = 'new'`) and uncompiled code. The view is read-only — it only has getters.

## What This Means for the Krauset Benchmark

### App component (reads `data` and `selected`)
- 2 reads per render
- Proxy: 2 × proxy trap overhead
- Compiled: 2 × class getter (10x faster each)
- Impact: small (only 2 reads)

### Row component × 1000 (reads `id` and `label`)
- 2000 reads total across all rows
- But only ~100 rows re-render on partial update
- Proxy: 200 × proxy trap overhead
- Compiled: 200 × class getter (10x faster each)
- Impact: moderate

### The real question
Does 10x faster reads translate to visible improvement in the krauset benchmark? The React reconciliation overhead may dominate. This needs to be measured end-to-end, not estimated.

## Action Plan

### Phase 1: Proxy fast path (no compiler needed)
1. Add solid-style fast path to proxy get trap
2. Benchmark the proxy improvement on krauset
3. This benefits ALL users immediately, compiled or not

### Phase 2: Class getter prototype
1. Hand-write view classes for the krauset types (RowData, AppState)
2. Hand-write `useCompiled` that returns view instances
3. Run krauset benchmark: proxy vs class-getter
4. Measure the actual end-to-end improvement

### Phase 3: Compiler generates view classes (only if Phase 2 shows meaningful improvement)
1. Plugin walks Branded<T> types and generates view classes
2. Plugin replaces useTracked with useCompiled + ViewClass
3. Plugin rewrites property reads to use the view

## Resolved Questions

1. **React tax**: The gap analysis proved React mount + act() is <0.1ms. The bottleneck was nested effect creation in reactive cycles, not React. The supergrain store itself runs at ~5ms — matching solid-js.

2. **Nested views**: `createView` handles nested objects via `createModelStore` with ArkType schemas. Nested views are cached per raw object via WeakMap.

3. **Array items**: The `$$()` direct DOM approach handles arrays via cloneNode + per-item signal subscriptions, matching solid's pattern.
