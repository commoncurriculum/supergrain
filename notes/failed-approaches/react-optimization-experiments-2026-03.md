# React Optimization Experiments → tracked() Architecture (March 2026)

A comprehensive record of approaches tried to achieve supergrain's core React goal: **minimal renders**. When a value deep in the store changes, only the component that reads that specific value should re-render. No parent cascade, no sibling re-renders.

Five approaches were tried. Four failed. The fifth — `tracked()` — succeeded and became the new architecture.

## Background: How alien-signals Tracking Works

alien-signals uses a global variable `currentSub` (accessed via `getCurrentSub()` / `setCurrentSub()`) to track which effect is currently executing. When a signal is read, it checks `currentSub` and adds itself to that effect's dependency list. When the signal's value changes, all subscribed effects are notified.

The core challenge in React: React components are functions that React calls. There's no built-in way to say "reads during THIS component's render should subscribe to THIS effect." The various experiments below are different attempts to bridge this gap.

## Starting Point

The krauset (js-framework-benchmark) showed:
- react-supergrain (proxy + For): 1.61x geometric mean vs solid-store at 1.00x
- react-supergrain-direct (DirectFor): catastrophic failures on remove (788x slower) and append (161x slower)

Neither benchmark package had any tests. The implementations had never been validated against the benchmark's expected behavior.

### The useTracked problem

The existing `useTracked` hook uses `createStableProxy` — a proxy wrapper that stores a single `effectNode` per proxy object in a global `proxyEffectMap`. On every property access, it sets `currentSub` to this stored effectNode:

```tsx
const proxy = new Proxy(target, {
  get(obj, prop, receiver) {
    const currentEffectNode = proxyEffectMap.get(proxy)
    const prevSub = getCurrentSub()
    setCurrentSub(currentEffectNode) // always routes to ONE effect
    try {
      const value = Reflect.get(obj, prop, receiver)
      if (value && typeof value === 'object') {
        return createStableProxy(value, currentEffectNode) // wraps children too
      }
      return value
    } finally {
      setCurrentSub(prevSub)
    }
  },
})
```

The problem: when App creates a proxy and For passes items to Row components, ALL reads through the proxy tree route to App's effect. When Row reads `item.label`, it goes through the same proxy chain → subscribed to App's effect. A label change on any row triggers App to re-render, which triggers For to iterate all 1000 items, which triggers 1000 memo comparisons. Only 1 row actually needs to re-render.

**What should happen**: label change on row 5 → only Row 5 re-renders. App doesn't know or care.

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

**Verdict**: Failed. The approach is fundamentally incompatible with in-place array mutations at scale.

---

## Experiment 2: createView / useView

**Hypothesis**: Getter-based signal reads (via `createView`) are faster than proxy trap reads (via `useTracked`), giving the 50% speedup seen in isolated benchmarks.

**Architecture**: `createView(store)` returns a frozen object with getter-defined properties. Each getter calls `this._n[key]()` — a direct signal read with no proxy trap overhead.

**Why isolated benchmarks showed 50% faster**: Those benchmarks measured only the read path — how fast you can read a signal value. A getter call (`this._n[key]()`) is cheaper than a proxy trap (handler lookup → Reflect.get → signal read → isWrappable check → proxy wrap). But in a full React render with 1000 rows, there are only 2 top-level reads where getters help (store.data, store.selected). The other 3000+ reads (each row's id, label, isSelected) go through reactive proxies regardless. The getter advantage applies to 0.07% of total reads — noise.

### Attempt 2a: createView with immutable-style updates

Since createView returned raw values (not reactive proxies) for nested properties, in-place mutations didn't work. Had to use immutable-style updates:

```tsx
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

**Result**: Slower than proxy on most operations due to O(n) array copies on every mutation.

**Verdict**: Failed.

### Attempt 2b: Fix getSignalGetter to return reactive proxies

Added reactive proxy wrapping to `getSignalGetter` in `read.ts` so nested values from createView are reactive:

```tsx
// Before: returns raw value
const getter = function (this: any) { return this._n[key]() }

// After: wraps objects/arrays in reactive proxies
const getter = function (this: any) {
  const value = this._n[key]()
  return isWrappable(value) ? createReactiveProxy(value) : value
}
```

**Result**: 10-30% improvement. But nested reads now go through reactive proxies — the same cost as the proxy approach. The getter advantage only helps 2 out of 3000+ reads.

**Verdict**: Marginal. Not worth the added complexity.

### Attempt 2c: useView hook with global currentSub

Set `currentSub` for the entire render so all signal reads are tracked:

```tsx
export function useView<T extends object>(store: T): Readonly<T> {
  // ... effect setup ...
  const prev = getCurrentSub()
  setCurrentSub(stateRef.current.effectNode)
  useLayoutEffect(() => { setCurrentSub(prev) }) // restore after commit
  return stateRef.current.view
}
```

**Bug**: `setCurrentSub` leaked into children's `useLayoutEffect` calls. React fires `useLayoutEffect` children-first during the commit phase. When Row components created their own effects (via `useDirectBindings`), those effects ran while `currentSub` was still App's effectNode. Result: App subscribed to ALL row-level signals.

### Attempt 2d: useView with per-getter tracking

Scoped currentSub to each getter call instead of the entire render:

```tsx
Object.defineProperty(wrapper, key, {
  get() {
    const prev = getCurrentSub()
    setCurrentSub(effectNode)
    try { return (baseView as any)[key] }
    finally { setCurrentSub(prev) }
  },
})
```

**Result**: Fixed the leak but only top-level reads were tracked. Array iteration by For happened with currentSub already restored, so structural mutations weren't detected.

**Verdict**: Failed. createView in React can't achieve both per-component scoping AND nested reactivity without either a global currentSub leak or missing structural subscriptions.

---

## Experiment 3: $$() Direct DOM Bindings

**Hypothesis**: Skip React re-rendering for value updates. The Vite compiler transforms `$$()` into `useRef` + `useDirectBindings` that wire alien-signals effects straight to DOM nodes.

### How the compiler transforms $$()

```tsx
// Developer writes:
<a>{$$(item.label)}</a>
<tr className={$$(() => isSelected ? 'danger' : '')}>

// Compiler generates:
const __$$0 = useRef(null)
const __$$1 = useRef(null)
useDirectBindings([
  { ref: __$$0, getter: () => item.label },
  { ref: __$$1, getter: () => isSelected ? 'danger' : '', attr: 'className' },
])
<a ref={__$$0}>{item.label}</a>
<tr ref={__$$1} className={isSelected ? 'danger' : ''}>
```

### Attempt 3a: $$() with standard memo — double work

The $$() effect updates the DOM directly, but React ALSO re-renders the component through the normal `useTracked` → For → version-based-memo path. Sequence for a label change:

1. `store.data[5].label = "new"` — label signal fires
2. $$() effect fires → `el.textContent = "new"` (direct DOM write)
3. App re-renders (useTracked's createStableProxy subscribes App to label)
4. For detects version change → Row re-renders via React → diffs → no-op (DOM already correct)

The effect did the work, then React re-rendered and diffed for nothing. Net result: slower than plain proxy due to effect setup/teardown cost (~25ms for 1000 rows on replace-all).

### Attempt 3b: $$() with memo(() => true) — store coupling

Prevent React re-renders so only $$() effects handle updates:

```tsx
const Row = memo(({ item, onSelect, onRemove }) => {
  return (
    <tr className={$$(() => store.selected === item.id ? 'danger' : '')}>
      <td>{item.id}</td>
      <td><a>{$$(item.label)}</a></td>
    </tr>
  )
}, () => true) // Never re-render
```

This required the Row to read `store.selected` directly instead of receiving `isSelected` as a prop. With `memo(() => true)`, the component never re-renders, so any prop-based value (a closure over a boolean) goes stale immediately. Only direct signal reads in $$() getters work.

**Result**: Fast (swap 0.3ms, select 1.9ms) but the Row was coupled to a specific store and unusable outside the benchmark. This was rejected as benchmark hacking.

### Alternative: per-field components

Instead of bypassing React with $$(), make each dynamic value its own tracked() component:

```tsx
const Label = tracked(({ item }) => <a>{item.label}</a>)
```

Works for text content (label change re-renders only the Label component). Doesn't work for attributes (className) — you can't make a component that just manages an attribute on a parent element. With tracked() (Experiment 5), this becomes largely unnecessary because the Row itself only re-renders when its specific data changes.

**Verdict**: $$() failed. Either double-work or store-coupled components. The per-component scoping from tracked() makes it unnecessary.

---

## Experiment 4: useScopedTracked (Per-Component Proxy Wrapper)

**Hypothesis**: Give each component its own proxy wrapper that routes signal reads to its own effect. Parent reads don't leak into children.

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
    // ... has, ownKeys with same save/restore pattern
  })
}
```

**Result**: Label isolation worked (only affected Row re-renders). But the per-access save/restore of `currentSub` in `wrapArray` during For's array iteration added overhead. For 1000 items: 1000 × (save + set + Reflect.get + restore) per `.map()` call. Swap was 2.4x slower.

Also tried subscribing to ownKeys instead of wrapping the array. But ownKeys doesn't fire on swap (element reassignment, not add/remove). Adding `bumpOwnKeysSignal` on every array element change caused splice to fire ownKeys 999 times — each element shift is a reassignment.

**Verdict**: Correct concept, wrong mechanism. Wrapping reads (proxy per access) is slower than wrapping renders (set currentSub once per component).

---

## Experiment 5: tracked() Component Wrapper (SUCCESS)

### The key insight

Experiments 2-4 all tried to control `currentSub` at the **read** level — wrapping each property access with save/restore. This is expensive (many property accesses per render) and complex (proxy wrappers, array wrappers, leaked contexts).

The breakthrough: control `currentSub` at the **render** level. Set it once before the component function runs, restore once after. The component function is synchronous — it returns JSX, and children render later in separate React calls. No leak, no per-access overhead.

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

**Why it doesn't leak**: `Component(props)` is a synchronous function call that returns JSX elements (React.createElement calls). It does NOT render child components — React does that later, in separate function calls. So `currentSub` is only active during THIS component's body. When React later renders a child `tracked()` component, that child sets its own `currentSub`.

This is the fundamental difference from Experiment 2c's `useLayoutEffect` approach, which deferred the restore to the commit phase (after children's effects had already run).

### What happens during a label change: old vs new

**Old architecture (useTracked + createStableProxy)**:
1. `store.data[5].label = "new"` — label signal fires
2. App's effect fires (because createStableProxy routed Row's label read to App's effect)
3. App re-renders → For iterates all 1000 items
4. For checks memo on each Row → 999 return true, Row 5 returns false (version changed)
5. Row 5 re-renders
6. **Total work**: 1 App render + 1000 memo checks + 1 Row render

**New architecture (tracked())**:
1. `store.data[5].label = "new"` — label signal fires
2. Row 5's effect fires (it subscribed to `item.label` during its own render)
3. Row 5 re-renders
4. App's effect does NOT fire (App never subscribed to item.label)
5. **Total work**: 1 Row render

### Usage pattern

```tsx
const App = tracked(() => {
  const selected = store.selected  // explicit read in App's body
  return (
    <For each={store.data}>
      {(item) => <Row key={item.id} item={item} isSelected={selected === item.id} />}
    </For>
  )
})

const Row = tracked(({ item, isSelected }) => {
  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td>{item.id}</td>
      <td><a>{item.label}</a></td>
    </tr>
  )
})
```

**Why `const selected = store.selected` must be in App's body**: The For callback `{(item) => <Row isSelected={selected === item.id} />}` runs inside For's render, NOT App's. By that point, App's `currentSub` has been restored. If `store.selected` were read inside the For callback, it would subscribe to For's parent (App via the `each` prop read), but the specific `selected` read would not be tracked. Reading it as a local variable in App's body ensures it's read with App's `currentSub` active.

**Why For is still needed**: `tracked()` scopes subscriptions per-component, but React still needs keyed reconciliation for structural changes (items added, removed, reordered). For provides this by iterating the array and generating keyed React elements.

Note: For's version-based memo mechanism (passing a `version` prop to trigger re-renders on proxy changes) becomes redundant with `tracked()`. Each Row has its own effect — when `item.label` changes, Row's effect fires `forceUpdate` directly, bypassing memo entirely. For is needed only for its keyed reconciliation role.

**Safe on non-reactive components**: If a `tracked()` component doesn't read any reactive proxies, its effect has zero dependencies and never fires. The component behaves identically to `memo()` with a tiny dormant effect (~1-2μs overhead on mount). This means `tracked()` can safely replace `memo()` as the default component wrapper — no downside.

### Experiment 5b: .map() instead of For

We tested dropping For entirely and using `.map()` directly:

```tsx
const App = tracked(() => {
  return <>{store.data.map(item => <Row key={item.id} item={item} />)}</>
})
```

This fixed the splice/push detection issue (because `.map()` iterates inside App's render with `currentSub` active, subscribing App to all index signals). But it reintroduced the useTracked problem — `item.label` reads during the `.map()` callback subscribe to App's effect, so label changes trigger App re-renders.

**Verdict**: For is still needed to create a render boundary between App and Row. The combination `tracked()` + `For` gives both per-component scoping AND keyed reconciliation.

### Core changes required

Three changes to `@supergrain/core`:

**1. $VERSION as signal** (`core.ts`): `bumpVersion` writes to a signal stored in the node map instead of incrementing a plain number:

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

Why a version signal instead of ownKeys: During splice on a 1000-item array, ~999 element shifts call `setProperty`. If each bumped ownKeys (`signal(signal() + 1)` — a read+write), that's 999 full signal read/write cycles with subscriber notification overhead. With the version signal, alien-signals deduplicates: the first write marks the subscriber dirty, remaining ~998 writes see "already dirty" and skip. Cost: ~0.2ms vs ~30ms.

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

This is the fix for the splice/push bug described below. When App reads `store.data`, the returned array automatically subscribes App to "any mutation on this array."

**3. trackSelf on array function access** (`read.ts`): Calling `.map()`, `.forEach()`, etc. on a reactive proxy array subscribes to ownKeys when there's an active subscriber:

```tsx
if (typeof value === 'function') {
  if (Array.isArray(target) && getCurrentSub()) trackSelf(target)
  return value
}
```

### Bug encountered and solved: splice/push not triggering re-render

With `tracked()` + `For`, splice and push didn't trigger App re-renders in some test configurations.

**Observation**: Tests with `console.log` in the App body passed; identical tests without it failed.

**Diagnosis**: Added effect fire counters to both passing and failing tests:

```
[PASS] after splice: rows=999, effects=1, renders=3  ← effect fired
[FAIL] after splice: rows=1000, effects=0, renders=2  ← effect never fired
```

**Root cause**: App's only signal subscription was to `store.data` (the data property signal — the reference to the array). Splice mutates the array in-place without changing its reference. The data signal didn't fire. App had no subscription to detect the in-place mutation.

The `console.log(store.data.length)` in the passing test accidentally read `store.data.length` through the reactive proxy with `currentSub` set, subscribing App to the length signal. Splice changes length → effect fired.

**Fix**: Core change #2 — auto-subscribing to the array's version signal when returning an array value. No explicit `.length` read needed.

**Red herrings tried before diagnosing**: React render bailout (Fragment key trick), queueMicrotask to defer forceUpdate, object-based useReducer state, hidden span elements. None were the cause. The root cause was only found by adding counters that showed `effects=0` — the effect literally never fired.

### Stale dependencies

The alien-signals `effect()` callback only runs `forceUpdate()` — it doesn't read any signals. When the effect re-runs (from a signal change), alien-signals clears the old dependency list and re-tracks during the callback. Since the callback doesn't read signals, the effect ends up with zero dependencies after each re-run.

Dependencies are re-established during the next React render, when `tracked()` sets `currentSub` and the component function reads signals. The lifecycle:

```
render → deps added → signal change → deps cleared + forceUpdate → render → deps re-added
```

**When stale deps could matter**: If a component conditionally reads different signals:

```tsx
const App = tracked(() => {
  if (showDetails) {
    return <div>{store.user.bio}</div>  // subscribes to user.bio
  }
  return <div>{store.user.name}</div>   // subscribes to user.name
})
```

After rendering with `showDetails=true`, the effect subscribes to `user.bio`. If `showDetails` becomes `false` (from some external state change that triggers a re-render), the effect re-runs, deps clear, and the next render subscribes to `user.name` only. But if `user.bio` changes AFTER the `showDetails=false` render without triggering a re-render first, the stale `user.bio` dep was already cleared, so no spurious re-render occurs. The deps are always current after each render.

The only edge case: two signals change between renders (e.g., during a batch). The first signal fires the effect → deps cleared → forceUpdate. The second signal change finds no subscriber (deps were cleared). But forceUpdate was already dispatched, so the re-render picks up both changes. No lost updates.

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

**Verdict**: tracked() is faster or equal on every operation, with massive wins on partial update (7.5x) and swap (4.7x). Zero regressions. Achieves the core goal: label change on row 5 re-renders only Row 5.

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
- **tracked()**: component wrapper, replaces `useTracked` + `createStableProxy` + `globalProxyCache` + `proxyEffectMap`

### Doesn't ship
- **DirectFor**: full DOM rebuild, fundamentally broken for structural mutations
- **createView / useView**: marginal improvement, adds complexity for noise-level gains
- **$$()**: double work with React, or requires store-coupled components
- **useScopedTracked**: correct concept but proxy wrapper is slower than tracked()
- **getSignalGetter proxy wrapping**: only useful for createView, not needed for tracked()

---

## Key Lessons

1. **Wrap the render, not the reads**: Per-access save/restore of `currentSub` (proxy wrapper approach) adds overhead proportional to the number of property accesses. Setting `currentSub` once per component render is O(1) regardless of how many properties are read.

2. **React component functions are synchronous boundaries**: `Component(props)` returns JSX without rendering children. Children render in separate React calls later. This means `currentSub` set before `Component(props)` and restored after does NOT leak into children — the critical property that makes tracked() work.

3. **createView is not useful in React**: The getter-vs-proxy advantage applies to 0.07% of reads in a 1000-row render. Noise compared to DOM work.

4. **$$() does double work**: The effect updates DOM, then React re-renders and diffs the same DOM. The only escape (`memo(() => true)`) requires store-coupled components.

5. **Array structural subscriptions need a version signal**: Individual index subscriptions (1000 per array) and ownKeys (fires 999x during splice) are both expensive. A version signal with alien-signals' dirty-marking deduplication fires once per batch.

6. **tracked() is safe as a universal wrapper**: No reactive reads → behaves as `memo()` with ~1-2μs dormant effect. No downside to using it on every component. Replaces both `useTracked()` and `memo()`.

7. **For is still needed, but for a different reason**: With `useTracked`, For provides version-based memo to detect item changes. With `tracked()`, that role is obsolete — each Row has its own effect. For is still needed for keyed reconciliation (add/remove/reorder), which React requires the full array to perform.

8. **Validate causes before creating fixes**: The splice/push bug was caused by a missing array subscription. Before finding this, multiple wrong fixes were tried (queueMicrotask, React bailout prevention, object-based forceUpdate). The root cause was only found by adding effect fire counters that showed `effects=0`.

9. **Benchmark methodology matters**: Single-run numbers varied 2-3x between runs. Reliable comparisons require: same Row template, fresh store per test, proper cleanup, same test file (for JIT consistency).
