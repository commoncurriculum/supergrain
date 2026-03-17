# React Optimization Experiments (March 2026)

A comprehensive record of approaches tried to improve supergrain's React benchmark performance. Documents what was tried, why it failed or succeeded, and the code involved.

## Context

Starting point: the krauset (js-framework-benchmark) showed react-supergrain at 1.61x geometric mean vs solid-store at 1.00x. The react-supergrain-direct variant (DirectFor) had catastrophic failures on remove (788x slower) and append (161x slower).

## Experiment 1: DirectFor (Full DOM Rebuild)

**Hypothesis**: Bypass React entirely with cloneNode + direct signal bindings for maximum performance.

**Architecture**: `DirectFor` subscribes to every array index via an alien-signals effect. When any index changes, it tears down ALL DOM rows and rebuilds from scratch.

```tsx
// direct-for.tsx — the outer effect
cleanupsRef.current.outer = effect(() => {
  const len = each.length
  for (let i = 0; i < len; i++) {
    each[i] // subscribes to each index signal
  }
  buildRef.current() // tears down ALL rows and rebuilds
})
```

**Result**: Fast for fine-grained updates (partial update 0.5ms, select 0.8ms) but catastrophically slow for structural mutations. Remove: 5,287ms (788x). Append: 5,474ms (161x). Full DOM rebuild on every splice/push.

**Why it failed**: The architecture has no concept of incremental DOM updates. Any structural change triggers a full teardown and rebuild of all rows. Fixing this would require implementing a DOM reconciliation algorithm — essentially reimplementing what React already does.

**Verdict**: Failed. The approach is fundamentally incompatible with in-place array mutations at scale.

---

## Experiment 2: createView / useView

**Hypothesis**: Getter-based signal reads (via `createView`) are faster than proxy trap reads (via `useTracked`), giving 50% speedup seen in isolated benchmarks.

**Architecture**: `createView(store)` returns a frozen object with getter-defined properties. Each getter calls `this._n[key]()` — a direct signal read, no proxy trap overhead.

### Attempt 2a: createView with immutable-style updates

The first attempt used createView as-is. Since createView returned raw values (not reactive proxies) for nested properties, in-place mutations didn't work. Had to use immutable-style updates:

```tsx
// Immutable operations — creates new arrays on every mutation
export const add = () => {
  store.data = [...store.data, ...buildData(1000)]
}
export const update = () => {
  store.data = store.data.map((item, i) =>
    i % 10 === 0 ? { ...item, label: item.label + ' !!!' } : item
  )
}
export const remove = (id: number) => {
  store.data = store.data.filter(item => item.id !== id)
}
```

**Result**: Slower than proxy on most operations due to array copy overhead. The getter-vs-proxy savings was wiped out by O(n) copies on every mutation.

**Verdict**: Failed. Immutable updates are inherently slower for large arrays.

### Attempt 2b: Fix getSignalGetter to return reactive proxies

Added `createReactiveProxy(value)` wrapping to `getSignalGetter` in `read.ts`:

```tsx
// read.ts — getSignalGetter before
const getter = function (this: any) {
  return this._n[key]()
}

// read.ts — getSignalGetter after
const getter = function (this: any) {
  const value = this._n[key]()
  return isWrappable(value) ? createReactiveProxy(value) : value
}
```

This let createView return reactive proxies for nested values, enabling in-place mutations. But it also meant nested reads went through reactive proxies — the same cost as the proxy approach. The getter advantage only applied to the 2 top-level reads (data, selected) vs 3000+ nested reads. Marginal improvement (10-30%).

**Verdict**: Marginal. The optimization only applies to top-level property reads, which are a tiny fraction of total reads during a 1000-row render.

### Attempt 2c: useView hook with global currentSub

Set `currentSub` for the entire render duration:

```tsx
export function useView<T extends object>(store: T): Readonly<T> {
  // ... effect setup ...

  // Set subscriber context for the render
  const prev = getCurrentSub()
  setCurrentSub(stateRef.current.effectNode)
  useLayoutEffect(() => { setCurrentSub(prev) })

  return stateRef.current.view
}
```

**Bug found**: `setCurrentSub` leaked into children's `useLayoutEffect` calls. When Row components had their own effects (via `useDirectBindings`), those effects were created with the App's effectNode as `currentSub`, causing the App to subscribe to ALL row-level signals. A label change on any row triggered an App re-render.

**Root cause**: `useLayoutEffect` fires children-first. App's `useLayoutEffect(() => setCurrentSub(prev))` runs AFTER Row's `useLayoutEffect`, so Row's effects see App's effectNode.

### Attempt 2d: useView with per-getter tracking

Fixed the leak by scoping currentSub to each getter call instead of the entire render:

```tsx
const wrapper = Object.create(null)
for (const key of Object.keys(baseView)) {
  Object.defineProperty(wrapper, key, {
    get() {
      const prev = getCurrentSub()
      setCurrentSub(effectNode)
      try {
        return (baseView as any)[key]
      } finally {
        setCurrentSub(prev)
      }
    },
  })
}
```

**Result**: Fixed the leak but reintroduced the problem from 2b — only top-level reads were tracked. Nested reads (array iteration by For) happened with currentSub restored, so structural mutations (splice, push) weren't detected.

**Verdict**: Failed. createView in React can't achieve both per-component scoping AND nested reactivity without either a global currentSub leak or missing structural subscriptions.

---

## Experiment 3: $$() Direct DOM Bindings

**Hypothesis**: Skip React re-rendering entirely for value updates. The Vite compiler transforms `$$()` calls into `useRef` + `useDirectBindings` pairs that wire alien-signals effects straight to DOM nodes.

### Attempt 3a: $$() with standard memo

```tsx
// What developers write:
<a>{$$(item.label)}</a>
<tr className={$$(() => isSelected ? 'danger' : '')}>

// What the compiler generates:
const __$$0 = useRef(null)
const __$$1 = useRef(null)
useDirectBindings([
  { ref: __$$0, getter: () => item.label },
  { ref: __$$1, getter: () => isSelected ? 'danger' : '', attr: 'className' },
])
<a ref={__$$0}>{item.label}</a>
<tr ref={__$$1} className={isSelected ? 'danger' : ''}>
```

**Problem**: $$() effects update the DOM, but React ALSO re-renders the component (because useTracked/For version-based memo detects the change). Double work: effect writes DOM, then React diffs and finds DOM already correct.

**Result**: Slower than plain proxy because of effect setup/teardown cost per row (~25ms for 1000 rows on replace-all) with no offsetting benefit.

### Attempt 3b: $$() with memo(() => true)

Prevent all React re-renders on the Row:

```tsx
const Row = memo(({ item, onSelect, onRemove }) => {
  return (
    <tr className={$$(() => store.selected === item.id ? 'danger' : '')}>
      <td>{item.id}</td>
      <td><a>{$$(item.label)}</a></td>
    </tr>
  )
}, () => true) // Never re-render — $$() handles all updates
```

**Problem**: Required changing the Row to read `store.selected` directly instead of receiving `isSelected` as a prop. With `memo(() => true)`, the component never re-renders, so prop-based `isSelected` (a closure over a boolean) goes stale. Only store-level signal reads in $$() getters work.

**Result**: Fast for updates (swap 0.3ms, select 1.9ms) but required store-coupled components — the Row was unusable outside the specific benchmark. Not real production code.

**Verdict**: Failed. $$() requires either double-work (effect + React re-render) or store-coupled components that break the props-based component model.

---

## Experiment 4: useScopedTracked (Per-Component Signal Scoping)

**Hypothesis**: Each component should have its own alien-signals effect and subscribe only to the signals it directly reads. Parent reads don't leak into children.

### The core problem with useTracked

`useTracked` uses `createStableProxy` with a `globalProxyCache`. All reads through the proxy tree route to a single stored effectNode. When Parent creates a proxy and passes it to Child, Child's reads of `item.label` subscribe to Parent's effect:

```tsx
// createStableProxy — the problem
const createStableProxy = (target, effectNode) => {
  if (globalProxyCache.has(target)) {
    const existingProxy = globalProxyCache.get(target)
    proxyEffectMap.set(existingProxy, effectNode) // overwrites!
    return existingProxy
  }
  // ...
}
```

The `proxyEffectMap` stores ONE effectNode per proxy. Whichever component accessed the proxy last "wins." All reads route to that component's effect.

### Attempt 4a: Scoped proxy per component

Each `useScopedTracked` call creates its own proxy wrapper that sets/restores currentSub per-access:

```tsx
function createScopedProxy<T extends object>(target: T, effectNode: any): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const prev = getCurrentSub()
      setCurrentSub(effectNode)
      try {
        const value = Reflect.get(obj, prop, receiver)
        if (Array.isArray(value)) return wrapArray(value, effectNode)
        return value
      } finally { setCurrentSub(prev) }
    },
    // ... has, ownKeys handlers with same pattern
  })
}
```

**Result**: Label isolation worked (only affected Row re-renders, App doesn't). But the per-access save/restore of currentSub in `wrapArray` added overhead during For's array iteration. Swap was 2.4x slower because 1000 save/restore cycles during `.map()`.

### Attempt 4b: Replace wrapArray with $TRACK subscription

Instead of wrapping the array, subscribe to ownKeys via `$TRACK` when returning an array:

```tsx
get(obj, prop, receiver) {
  const prev = getCurrentSub()
  setCurrentSub(effectNode)
  try {
    const value = Reflect.get(obj, prop, receiver)
    if (Array.isArray(value) && typeof value === 'object') {
      const $TRACK = Symbol.for('supergrain:track')
      if ($TRACK in value) (value as any)[$TRACK]
    }
    return value
  } finally { setCurrentSub(prev) }
}
```

**Problem**: ownKeys doesn't fire on swap (swap is element reassignment, not add/remove). Added `bumpOwnKeysSignal` on every array element change in `setProperty`, but this caused splice to fire ownKeys 999 times — each element shift during splice bumps ownKeys.

**Verdict**: Partially successful. Per-component scoping works but the proxy wrapper approach has inherent overhead from per-access currentSub manipulation.

---

## Experiment 5: tracked() Component Wrapper (SUCCESS)

**Hypothesis**: Instead of a hook inside the component, wrap the component definition itself. Set `currentSub` once before the component function, restore once after. No proxy wrapper needed.

```tsx
function tracked<P extends object>(Component: FC<P>): FC<P> {
  const Tracked: FC<P> = (props: P) => {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
    const ref = useRef<{ cleanup: (() => void); effectNode: any } | null>(null)
    if (!ref.current) {
      let effectNode: any = null
      let firstRun = true
      const cleanup = effect(() => {
        if (firstRun) { effectNode = getCurrentSub(); firstRun = false; return }
        forceUpdate()
      })
      ref.current = { cleanup, effectNode }
    }
    useEffect(() => () => { ref.current?.cleanup?.() }, [])

    const prev = getCurrentSub()
    setCurrentSub(ref.current.effectNode)
    const result = Component(props)
    setCurrentSub(prev)
    return result
  }
  return memo(Tracked) as unknown as FC<P>
}
```

**Key insight**: `Component(props)` is synchronous and returns JSX. Children don't render inside it — React renders them later. So `currentSub` is only active during THIS component's function body. No leak into children.

### Usage pattern

```tsx
// App subscribes to store.data (structure) and store.selected
const App = tracked(() => {
  const selected = store.selected  // explicit read
  return (
    <For each={store.data}>
      {(item) => <Row key={item.id} item={item} isSelected={selected === item.id} />}
    </For>
  )
})

// Row subscribes to item.id, item.label independently
const Row = tracked(({ item, isSelected }) => {
  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td>{item.id}</td>
      <td><a>{item.label}</a></td>
    </tr>
  )
})
```

### Core changes required

1. **$VERSION as signal** (`core.ts`): `bumpVersion` writes to a signal instead of incrementing a number. Alien-signals deduplicates dirty-marking, so 1000 writes during splice cost ~0.2ms.

2. **Array version auto-subscribe** (`read.ts`): When the reactive proxy returns an array with an active subscriber, automatically subscribe to the array's version signal:

```tsx
if (isWrappable(value)) {
  const proxy = createReactiveProxy(value)
  if (Array.isArray(value) && getCurrentSub()) {
    const arrayNodes = getNodes(value)
    if (arrayNodes[$VERSION]) arrayNodes[$VERSION]()
  }
  return proxy
}
```

3. **trackSelf on array function access** (`read.ts`): Calling `.map()`, `.forEach()`, etc. on a reactive proxy subscribes to ownKeys when there's an active subscriber.

### Bug encountered: splice/push not triggering re-render

With `tracked()` + `For`, splice and push didn't trigger App re-renders in some test configurations. Diagnosis revealed:

- `<For each={store.data}>` passes the array to For as a prop
- For iterates in ITS OWN render — after `currentSub` is restored
- App only subscribes to the `data` signal (array reference), not to structural mutations
- Splice/push mutate in-place without changing the array reference
- The `data` signal doesn't fire, so App never re-renders

**Fix**: The core-level change (#2 above) — auto-subscribing to the array's version signal when returning an array. This means `store.data` returning an array automatically subscribes to "any mutation on this array." Splice, push, swap — all bump the version signal.

### A debugging red herring

During diagnosis, tests with `console.log` in the App body passed while identical tests without it failed. Multiple hypotheses were tested (React bailout, effect re-entrancy, queueMicrotask). The actual cause: `console.log(store.data.length)` reads `store.data.length` through the reactive proxy with `currentSub` set, subscribing App to the length signal. Without it, App had no subscription to detect splice/push. The core-level auto-subscribe fix eliminated this issue.

### Final results (apples-to-apples, same Row template)

| Operation | Proxy (useTracked) | tracked() | delta |
|---|---|---|---|
| create 1000 | 57.9ms | 40.3ms | **tracked 30% faster** |
| replace all | 61.7ms | 52.0ms | **tracked 16% faster** |
| partial update | 18.0ms | 2.4ms | **tracked 7.5x faster** |
| select row | 5.6ms | 3.8ms | **tracked 32% faster** |
| swap rows | 40.6ms | 8.7ms | **tracked 4.7x faster** |
| remove row | 7.6ms | 6.0ms | **tracked 21% faster** |
| create 10000 | 759ms | 615ms | **tracked 19% faster** |
| append 1000 | 51.0ms | 55.5ms | ~same |
| clear | 10.7ms | 10.5ms | same |

**Verdict**: Success. tracked() is faster or equal on every operation, with massive wins on partial update (7.5x) and swap (4.7x). Zero regressions.

---

## Key Lessons

1. **createView is not useful in React**: The getter-vs-proxy advantage only applies to top-level property reads. In a 1000-row render, there are 2 top-level reads vs 3000+ nested reads. The optimization is noise.

2. **$$() does double work with React**: The effect updates the DOM, then React re-renders and diffs the same DOM. The only way to avoid this (memo(() => true)) breaks the component model.

3. **DirectFor needs DOM reconciliation**: Full rebuild on structural change is fundamentally broken. Fixing it means reimplementing React's reconciler.

4. **Per-component scoping is the right abstraction**: Each component subscribes to exactly the signals it reads. Parent reads don't leak into children. This is what `tracked()` achieves.

5. **The proxy wrapper approach (useScopedTracked) is slower than tracked()**: Per-access save/restore of currentSub adds overhead during array iteration. tracked() sets currentSub once for the entire component body — cheaper and simpler.

6. **Array structural subscriptions need a version signal**: Subscribing to individual indices (1000 subscriptions) or ownKeys (fires 999 times during splice) are both expensive. A version signal with alien-signals' dirty-marking deduplication fires once regardless of how many mutations happen.

7. **Validate causes before creating fixes**: During debugging, multiple "fixes" were tried (queueMicrotask, React bailout prevention, object-based forceUpdate) without confirming the root cause. The actual issue (missing array structural subscription) was only found through systematic instrumentation.
