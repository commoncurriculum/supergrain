# React Optimization Experiments (March 2026)

A comprehensive record of approaches tried to improve supergrain's React benchmark performance. Documents what was tried, why it failed or succeeded, the code involved, and the bugs discovered along the way.

## Goal

Supergrain's core goal: **minimal renders**. When a value deep in the store changes, only the component that reads that specific value should re-render. No parent cascade, no sibling re-renders.

## Starting Point

The krauset (js-framework-benchmark) showed:
- react-supergrain (proxy + For): 1.61x geometric mean vs solid-store at 1.00x
- react-supergrain-direct (DirectFor): catastrophic failures on remove (788x slower) and append (161x slower)
- react-storable: broken (not found in package-lock)

Neither benchmark package had any tests. The implementations had never been validated against the benchmark's expected behavior.

## Bug Discovery: splice Completely Broken

Before any optimization work, we discovered that `Array.prototype.splice` was completely broken on store proxies. The `deleteProperty` handler in `write.ts` threw unconditionally:

```tsx
// write.ts — the bug
deleteProperty() {
  throw new Error(
    'Direct deletion of store state is not allowed. Use the "$unset" operator in the update function.'
  )
}
```

When `splice` removes an element, JavaScript internally calls `deleteProperty` on the array to remove the now-out-of-range index. This meant `store.data.splice(index, 1)` always threw. Same for `pop()` and `shift()`.

**Fix**: Allow silent deletes on arrays, bump ownKeys for structural subscribers:

```tsx
deleteProperty(target: any, prop: PropertyKey): boolean {
  if (Array.isArray(target)) {
    const hadKey = Object.prototype.hasOwnProperty.call(target, prop)
    delete target[prop as any]
    if (hadKey) {
      bumpOwnKeysSignal(target)
    }
    return true
  }
  throw new Error('Direct deletion of store state is not allowed...')
}
```

This was a real production bug, not just a benchmark issue. Any code using `splice`, `pop`, or `shift` on a store array would crash.

---

## Experiment 1: DirectFor (Full DOM Rebuild)

**Hypothesis**: Bypass React entirely with `cloneNode` + direct signal bindings for maximum performance.

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

Each row gets per-field effects for label updates and selection:

```tsx
setup={(item: RowData, row, addEffect) => {
  const tds = row.children
  const td0 = tds[0] as HTMLElement
  const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement

  td0.textContent = String(item.id)
  a1.textContent = item.label

  addEffect(() => { a1.textContent = (item as any).label })
  addEffect(() => {
    row.className = store.selected === item.id ? 'danger' : ''
  })
}
```

**Result**: Fast for fine-grained updates (partial update 0.5ms, select 0.8ms) but catastrophically slow for structural mutations. Remove: 5,287ms (788x). Append: 5,474ms (161x). Full DOM rebuild on every splice/push.

**Why it failed**: The architecture has no concept of incremental DOM updates. Any structural change triggers a full teardown and rebuild of all rows. Fixing this would require implementing a DOM reconciliation algorithm — essentially reimplementing what React already does.

**Alternative considered**: Use `<For>` for list reconciliation + `$$()` for value bindings (React handles structure, effects handle values). This led to Experiment 3.

**Verdict**: Failed. The approach is fundamentally incompatible with in-place array mutations at scale.

---

## Experiment 2: createView / useView

**Hypothesis**: Getter-based signal reads (via `createView`) are faster than proxy trap reads (via `useTracked`), giving the 50% speedup seen in isolated benchmarks.

**Architecture**: `createView(store)` returns a frozen object with getter-defined properties. Each getter calls `this._n[key]()` — a direct signal read with no proxy trap overhead.

**Why isolated benchmarks showed 50% faster**: Those benchmarks tested only the read path (getter call vs proxy trap) without React rendering. In a full React render cycle with 1000 rows, the DOM work dominates and the getter-vs-proxy difference is noise — there are only 2 top-level reads (data, selected) vs 3000+ nested reads, and the nested reads go through reactive proxies either way.

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

**Result**: Slower than proxy on most operations due to array copy overhead (e.g., swap required `.slice()` + array reassignment). The getter-vs-proxy savings was wiped out by O(n) copies on every mutation.

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

This let createView return reactive proxies for nested values, enabling in-place mutations. But it also meant nested reads went through reactive proxies — the same cost as the proxy approach. The getter advantage only applied to the 2 top-level reads (data, selected) vs 3000+ nested reads.

**Result**: 10-30% improvement on some operations, regression on others. Not a clear win.

**Verdict**: Marginal. The optimization only applies to top-level property reads, which are a tiny fraction of total reads during a 1000-row render.

### Attempt 2c: useView hook with global currentSub

Set `currentSub` for the entire render duration so all signal reads during the component's render are tracked:

```tsx
export function useView<T extends object>(store: T): Readonly<T> {
  // ... effect setup (same pattern as useTracked) ...

  // Set subscriber context for the render
  const prev = getCurrentSub()
  setCurrentSub(stateRef.current.effectNode)
  useLayoutEffect(() => { setCurrentSub(prev) })

  return stateRef.current.view
}
```

**Bug found**: `setCurrentSub` leaked into children's `useLayoutEffect` calls. React fires `useLayoutEffect` in children-first order. When Row components had their own effects (via `useDirectBindings`), those effects were created while `currentSub` was still App's effectNode. This caused the App to subscribe to ALL row-level signals — a label change on any row triggered an App re-render.

**Root cause**: `useLayoutEffect` fires children-first during commit. App's `useLayoutEffect(() => setCurrentSub(prev))` runs AFTER all Row `useLayoutEffect` calls. During those Row effects, `getCurrentSub()` returns App's effectNode, so Row-level signal reads subscribe to App's effect.

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

**Result**: Fixed the leak but reintroduced the problem from 2b — only top-level reads were tracked. When App reads `view.data`, the getter sets/restores currentSub. The returned reactive proxy array is iterated by `For` in its own render, where currentSub is already restored. So structural mutations (splice, push) on the array weren't detected by App.

**Verdict**: Failed. createView in React can't achieve both per-component scoping AND nested reactivity without either a global currentSub leak or missing structural subscriptions.

---

## Experiment 3: $$() Direct DOM Bindings

**Hypothesis**: Skip React re-rendering entirely for value updates. The Vite compiler transforms `$$()` calls into `useRef` + `useDirectBindings` pairs that wire alien-signals effects straight to DOM nodes.

### How the compiler transforms $$()

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

The `useDirectBindings` runtime creates one alien-signals `effect()` per binding:

```tsx
export function useDirectBindings(bindings: DirectBinding[]): void {
  useLayoutEffect(() => {
    const cleanups = bindings.map(({ ref, getter, attr }) => {
      return effect(() => {
        const el = ref.current
        if (!el) return
        const value = getter()
        if (attr) {
          ;(el as any)[attr] = value
        } else {
          el.textContent = String(value)
        }
      })
    })
    return () => { for (const c of cleanups) c() }
  }, [])
}
```

### Attempt 3a: $$() with standard memo

**Problem**: $$() effects update the DOM, but React ALSO re-renders the component. Here's the sequence for a label change:

1. `store.data[5].label = "new"` — label signal fires
2. $$() effect fires → sets `el.textContent = "new"` (direct DOM write)
3. App re-renders (useTracked subscribes to label through createStableProxy)
4. For detects version change on item 5 → passes new version prop
5. Row re-renders via React → creates VDOM → diffs → finds textContent already correct → no-op

Steps 2-5 are double work. The effect wrote the correct value, then React re-rendered and diffed the same DOM for nothing.

**Result**: Slower than plain proxy because of effect setup/teardown cost per row (~25ms for 1000 rows on replace-all) with no offsetting benefit from the double-work pattern.

### Attempt 3b: $$() with memo(() => true)

Prevent all React re-renders on the Row so only $$() effects handle updates:

```tsx
// Row reads store.selected directly, not from props
const Row = memo(({ item, onSelect, onRemove }) => {
  return (
    <tr className={$$(() => store.selected === item.id ? 'danger' : '')}>
      <td>{item.id}</td>
      <td><a>{$$(item.label)}</a></td>
    </tr>
  )
}, () => true) // Never re-render — $$() handles all updates
```

**Problem**: Required changing the Row to read `store.selected` directly instead of receiving `isSelected` as a prop. With `memo(() => true)`, the component never re-renders, so prop-based `isSelected` (a closure over a boolean) goes stale. Only store-level signal reads in $$() getters work, because signals trigger the effect to re-run even without a React re-render.

**Result**: Fast for updates (swap 0.3ms, select 1.9ms) but required store-coupled components — the Row was unusable outside the specific benchmark. This was rejected as benchmark hacking, not a legitimate optimization.

### Alternative considered: per-field components

Instead of $$() bypassing React, what about making each dynamic value its own tiny component?

```tsx
const Label = tracked(({ item }) => {
  return <a>{item.label}</a>
})
```

This achieves similar granularity (label change only re-renders the Label component, not the whole Row) using standard React patterns. Works for text content but not for attributes (className) — you can't make a component that just manages an attribute on a parent element.

**Verdict**: $$() failed for the benchmark. It requires either double-work (effect + React re-render) or store-coupled components that break the props-based component model. Per-field components work for text content but not attributes. With tracked() (Experiment 5), the per-component scoping makes $$() largely unnecessary — the Row only re-renders when its specific data changes.

---

## Experiment 4: useScopedTracked (Per-Component Signal Scoping)

**Hypothesis**: Each component should have its own alien-signals effect and subscribe only to the signals it directly reads. Parent reads don't leak into children.

### The core problem with useTracked

`useTracked` uses `createStableProxy` with a `globalProxyCache`. All reads through the proxy tree route to a single stored effectNode:

```tsx
// createStableProxy — the problem
const createStableProxy = (target, effectNode) => {
  if (globalProxyCache.has(target)) {
    const existingProxy = globalProxyCache.get(target)
    proxyEffectMap.set(existingProxy, effectNode) // overwrites!
    return existingProxy
  }
  // Creates a new proxy with get handler that sets currentSub = effectNode
  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      const currentEffectNode = proxyEffectMap.get(proxy)
      if (currentEffectNode) {
        const prevSub = getCurrentSub()
        setCurrentSub(currentEffectNode)
        try {
          const value = Reflect.get(obj, prop, receiver)
          if (value && typeof value === 'object') {
            return createStableProxy(value, currentEffectNode)
          }
          return value
        } finally {
          setCurrentSub(prevSub)
        }
      }
      // ...
    },
  })
  globalProxyCache.set(target, proxy)
  proxyEffectMap.set(proxy, effectNode)
  return proxy
}
```

The `proxyEffectMap` stores ONE effectNode per proxy. When App creates a proxy for an item and passes it to Row, the proxy's effectNode is App's. Row's reads of `item.label` go through the same proxy → subscribed to App's effect. When `item.label` changes, App re-renders (not just Row).

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

Returned values from the proxy are the raw reactive proxies from the store (stable identity for `memo` comparison). Only the wrapper proxy is per-component; the underlying objects are shared.

**Result**: Label isolation worked — only the affected Row re-renders, App doesn't. But the `wrapArray` proxy added per-access save/restore of currentSub during For's array iteration. For 1000 items, that's 1000 × (getCurrentSub + setCurrentSub + Reflect.get + setCurrentSub) = significant overhead. Swap was 2.4x slower.

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

**Problem**: ownKeys doesn't fire on swap. Swap does `store.data[1] = otherItem` — this is element reassignment, not add/remove. To detect it, we added `bumpOwnKeysSignal` on every array element change in `setProperty`:

```tsx
// Added to setProperty
} else if (Array.isArray(target) && didChange && key !== 'length') {
  bumpOwnKeysSignal(target, nodes)
}
```

This caused splice to fire ownKeys 999 times — each element shift (`array[i] = array[i+1]`) bumps ownKeys. The 999x overhead made remove 2x slower.

**Verdict**: Per-component scoping works conceptually but the proxy wrapper approach has inherent overhead. The per-access save/restore of currentSub and the ownKeys bump frequency are both problems.

---

## Experiment 5: tracked() Component Wrapper (SUCCESS)

**Hypothesis**: Instead of a hook inside the component or a proxy wrapper, wrap the component *definition* itself. Set `currentSub` once before the component function, restore once after. No proxy wrapper at all.

### Implementation

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

**Key insight**: `Component(props)` is synchronous and returns JSX elements. Children don't render inside it — React renders them later, in a separate call. So `currentSub` is only active during THIS component's function body. When React later renders a child component, that child's `tracked()` wrapper sets its OWN `currentSub`.

This is fundamentally different from the `useView` approach (Experiment 2c) where `setCurrentSub` leaked into children via `useLayoutEffect` timing. Here, the save/restore happens synchronously around the function call, not deferred to a lifecycle hook.

### Usage pattern

```tsx
// App subscribes to store.data (structure) and store.selected
const App = tracked(() => {
  const selected = store.selected  // explicit read — subscribes App to selected
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

**Why `const selected = store.selected` is needed**: The For callback `{(item) => <Row ... isSelected={selected === item.id} />}` runs inside For's render, not App's. Without reading `store.selected` in App's body (where `currentSub` is set), App would never subscribe to `selected` changes.

**Why For is still needed**: Even though tracked() scopes subscriptions per-component, we still need For for React's keyed reconciliation. When items are added, removed, or reordered, React needs the new list to diff against the old. For provides this by iterating the array and matching elements by key.

**Safe on non-reactive components**: If a `tracked()` component doesn't read any reactive proxies, its effect has zero dependencies and never fires. The component behaves identically to `memo()` with a tiny dormant effect (~1-2μs overhead on mount). This means `tracked()` can safely replace `memo()` as the default component wrapper.

### Core changes required

Three changes to `@supergrain/core` were needed:

**1. $VERSION as signal** (`core.ts`): `bumpVersion` writes to a signal stored in the node map instead of incrementing a plain number. This enables subscribing to "any mutation on this object":

```tsx
// core.ts — version signal created lazily in getNodes
if (!nodes[$VERSION]) {
  nodes[$VERSION] = signal(0) as Signal<any>
}

// write.ts — bumpVersion writes to the signal
export function bumpVersion(target: object): void {
  let nodes = (target as any)[$NODE]
  if (!nodes) { nodes = getNodes(target) }
  const v = nodes[$VERSION]
  if (v) v(v() + 1)
}
```

Alien-signals deduplicates dirty-marking: the first version write marks the subscriber dirty, remaining writes during splice (~999 element shifts) see "already dirty" and skip notification. The subscriber evaluates once. Cost: ~0.2ms for 1000 signal writes.

**2. Array version auto-subscribe** (`read.ts`): When the reactive proxy returns an array value with an active subscriber, automatically subscribe to the array's version signal:

```tsx
if (isWrappable(value)) {
  const proxy = createReactiveProxy(value)
  if (Array.isArray(value) && getCurrentSub()) {
    const arrayNodes = getNodes(value)
    if (arrayNodes[$VERSION]) arrayNodes[$VERSION]() // subscribe to version
  }
  return proxy
}
```

This is the fix for the "splice/push not triggering re-render" bug (see below). When App reads `store.data` and gets back a reactive proxy array, it automatically subscribes to "any mutation on this array" via the version signal. Splice, push, swap — all bump version.

**3. trackSelf on array function access** (`read.ts`): Calling `.map()`, `.forEach()`, etc. on a reactive proxy array subscribes to ownKeys when there's an active subscriber:

```tsx
if (typeof value === 'function') {
  if (Array.isArray(target) && getCurrentSub()) trackSelf(target)
  return value
}
```

### Bug encountered and solved: splice/push not triggering re-render

With `tracked()` + `For`, splice and push didn't trigger App re-renders. Diagnosis through systematic instrumentation:

**Observation**: Tests with `console.log` in the App body passed; identical tests without it failed.

**Diagnosis**: Added effect fire counters and render counters to both passing and failing tests. The passing test showed `effects=1` after splice (effect fired). The failing test showed `effects=0` (effect never fired).

**Root cause**: Without the `console.log`, the App's only signal subscription was to `store.data` (the data property signal). Splice mutates the array in-place — the data signal's value (the array reference) doesn't change. Without a subscription to the array's structural changes, App never learned about the splice.

The `console.log(store.data.length)` in the passing test read `store.data.length` through the reactive proxy with `currentSub` set, subscribing App to the length signal. Splice changes length → effect fired → re-render.

**Fix**: Core change #2 above — auto-subscribing to the array's version signal when returning an array. No explicit `.length` read needed.

**Red herrings tried before finding the root cause**: React bailout optimization (Fragment key), queueMicrotask to defer forceUpdate, object-based useReducer state, hidden span elements. None were the issue. The root cause was only found through systematic instrumentation (effect fire counters showing effects=0).

### The ownKeys vs version signal tradeoff

During Experiment 4, we tried bumping ownKeys on every array element reassignment to detect swaps. This worked for swaps but caused splice to fire ownKeys 999 times (each element shift is a reassignment).

The version signal approach solves this: `bumpVersion` fires the version signal on every `setProperty` that changes a value, but alien-signals deduplicates the dirty-marking. The subscriber is marked dirty on the first signal write; the remaining ~999 writes see "already dirty" and do nothing. Cost: ~0.2ms for the signal writes vs ~30ms for 999 ownKeys bumps.

### Stale dependencies

One technical note: the alien-signals `effect()` callback only runs `forceUpdate()` — it doesn't read any signals. When the effect re-runs (from a signal change), alien-signals clears the old dependency list and re-tracks during the callback. Since the callback doesn't read signals, the effect ends up with zero dependencies.

Dependencies are re-established during the next React render, when `tracked()` sets `currentSub` and the component function reads signals. This creates a pattern: render → deps added → signal change → deps cleared + forceUpdate → render → deps re-added.

This works correctly for all benchmark operations because each signal change triggers exactly one render, and each render re-establishes the needed subscriptions. For dynamic components that conditionally read different signals across renders, stale deps could accumulate (deps from render N are not cleaned until the next effect re-run). In practice this causes at most one extra render — the stale dep fires the effect, the render reads the current deps, and subsequent changes are correct.

### Final results (apples-to-apples, same Row template, fresh store per test)

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

**Verdict**: Success. tracked() is faster or equal on every operation, with massive wins on partial update (7.5x) and swap (4.7x). Zero regressions. Achieves the core goal: label change on row 5 re-renders only Row 5, not the App or any other Row.

---

## Summary: What Ships, What Doesn't

### Ships (committed)
- **splice/pop/shift fix**: `deleteProperty` on arrays — real production bug
- **$VERSION as signal**: enables efficient structural subscriptions
- **Array version auto-subscribe**: fixes splice/push detection in tracked() architecture
- **trackSelf on array function access**: ownKeys subscription on .map()/.forEach()
- **Krauset benchmark tests**: correctness + performance tests for both packages
- **Vite plugin CJS fix**: .cjs extension for type: module packages

### Ships next
- **tracked()**: component wrapper, replaces `useTracked` + `createStableProxy`

### Doesn't ship
- **DirectFor**: full DOM rebuild architecture, fundamentally broken for structural mutations
- **createView / useView**: marginal improvement, adds complexity for noise-level gains
- **$$()**: double work with React, or requires store-coupled components
- **useScopedTracked**: correct concept but the proxy wrapper approach is slower than tracked()
- **getSignalGetter reactive proxy wrapping**: only useful for createView, not needed for tracked()

---

## Key Lessons

1. **createView is not useful in React**: The getter-vs-proxy advantage only applies to top-level property reads. In a 1000-row render, there are 2 top-level reads vs 3000+ nested reads. The optimization is noise compared to React DOM work.

2. **$$() does double work with React**: The effect updates the DOM, then React re-renders and diffs the same DOM. The only way to avoid this (`memo(() => true)`) breaks the component model by requiring store-coupled components.

3. **DirectFor needs DOM reconciliation**: Full rebuild on structural change is fundamentally broken at scale. Fixing it means reimplementing React's reconciler — a different project entirely.

4. **Per-component scoping is the right abstraction**: Each component subscribes to exactly the signals it reads. Parent reads don't leak into children. This is what `tracked()` achieves.

5. **tracked() is simpler AND faster than useScopedTracked**: Per-access save/restore of currentSub (the proxy wrapper approach) adds overhead during array iteration. tracked() sets currentSub once for the entire component body — cheaper, simpler, and no proxy wrapper needed.

6. **Array structural subscriptions need a version signal**: Subscribing to individual indices (1000 subscriptions per array) or ownKeys (fires 999 times during splice) are both expensive. A version signal with alien-signals' dirty-marking deduplication fires once regardless of how many mutations happen during a single operation.

7. **tracked() is safe as a universal wrapper**: Components that don't read reactive data behave identically to `memo()` with negligible overhead (~1-2μs for a dormant effect). No downside to using `tracked()` on every component.

8. **For is still needed with tracked()**: tracked() scopes subscriptions per-component, but React still needs keyed reconciliation for structural changes. For provides this. The combination `tracked()` + `For` gives both per-component scoping AND efficient list reconciliation.

9. **Validate causes before creating fixes**: During debugging, multiple "fixes" were tried (queueMicrotask, React bailout prevention, object-based forceUpdate) without confirming the root cause. The actual issue (missing array structural subscription) was only found through systematic instrumentation — adding effect fire counters to both passing and failing tests.

10. **Single-run benchmark numbers are noisy**: Numbers varied 2-3x between test runs depending on JIT warmup, test ordering, and browser state. Reliable comparisons require apples-to-apples tests in the same file with the same Row template, fresh stores, and proper cleanup.
