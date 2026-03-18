# React Optimization Experiments → tracked() Architecture (March 2026)

Five approaches tried to achieve supergrain's minimal-render goal. Four failed. The fifth — `tracked()` — succeeded and replaces `useTracked`.

> **Background**: The nested component problem and useTracked's per-access proxy swap solution are documented in [react-tracking-approaches.md](react-tracking-approaches.md), [useTracked.md](../react-adapter/useTracked.md), and [v4-nested-components.md](../react-adapter/v4-nested-components.md).

## The useTracked Problem

useTracked solved the nested component problem via per-access proxy swaps (see [useTracked.md](../react-adapter/useTracked.md)). But it introduced a different problem: **parent over-subscription**.

`createStableProxy` stores ONE effectNode per proxy in a global `proxyEffectMap`. When App creates a proxy for `store.data[5]` and passes it to Row, the proxy's effectNode is App's. Row's reads of `item.label` go through the same proxy → subscribed to App's effect.

**What happens on a label change**:
1. `store.data[5].label = "new"` — label signal fires
2. App's effect fires (createStableProxy routed Row's label read to App)
3. App re-renders → For iterates all 1000 items
4. 999 memo checks return true, Row 5 returns false (version changed)
5. Row 5 re-renders
6. **Total work**: 1 App render + 1000 memo checks + 1 Row render

**What should happen**: label change → only Row 5 re-renders. App doesn't know or care.

## Starting Point

The krauset benchmark showed react-supergrain at 1.61x geometric mean. react-supergrain-direct (DirectFor) had catastrophic remove (788x) and append (161x). Neither package had tests.

## Bug Discovery: splice Completely Broken

`deleteProperty` in `write.ts` threw unconditionally. Since `splice` internally calls `deleteProperty` to remove out-of-range indices, `store.data.splice(index, 1)` always threw. Same for `pop()` and `shift()`. Real production bug.

**Fix**: Allow silent deletes on arrays with ownKeys bump:

```tsx
deleteProperty(target: any, prop: PropertyKey): boolean {
  if (Array.isArray(target)) {
    const hadKey = Object.prototype.hasOwnProperty.call(target, prop)
    delete target[prop as any]
    if (hadKey) bumpOwnKeysSignal(target)
    return true
  }
  throw new Error('Direct deletion of store state is not allowed...')
}
```

---

## Experiment 1: DirectFor (Full DOM Rebuild)

**Hypothesis**: Bypass React with `cloneNode` + direct signal bindings.

**Architecture**: Subscribes to every array index. On any change, tears down ALL rows and rebuilds from scratch.

```tsx
cleanupsRef.current.outer = effect(() => {
  const len = each.length
  for (let i = 0; i < len; i++) { each[i] }
  buildRef.current() // tears down ALL rows and rebuilds
})
```

**Result**: Fast for value updates (partial 0.5ms, select 0.8ms) but catastrophic for structural mutations. Remove: 5,287ms. Append: 5,474ms.

**Verdict**: Failed. No incremental DOM updates. Fixing requires reimplementing React's reconciler.

---

## Experiment 2: createView / useView

**Hypothesis**: Getter-based reads (via `createView`) are faster than proxy traps (via `useTracked`), giving the 50% speedup seen in isolated benchmarks.

**Why 50% didn't materialize in React**: Isolated benchmarks measured only the read path. In a full 1000-row render, there are 2 top-level reads where getters help vs 3000+ nested reads that go through reactive proxies regardless. The getter advantage applies to 0.07% of reads.

Four sub-attempts:

**2a: Immutable updates** — createView returned raw values for nested properties, requiring `map`/`filter`/`slice` for mutations. O(n) copies on every operation. Failed.

**2b: Fix getSignalGetter to return reactive proxies** — Made createView wrap nested values in reactive proxies. But then nested reads cost the same as the proxy approach. 10-30% improvement — marginal.

**2c: useView with global currentSub** — Set `currentSub` for the entire render, restore in `useLayoutEffect`. Bug: leaked into children's `useLayoutEffect` (React fires them children-first during commit). App subscribed to ALL row-level signals.

**2d: Per-getter tracking wrapper** — Scoped `currentSub` to each getter call. Fixed the leak but only top-level reads were tracked. Array iteration by For happened with `currentSub` restored, so splice/push weren't detected.

**Verdict**: Failed. createView can't achieve both per-component scoping AND nested reactivity in React.

---

## Experiment 3: $$() Direct DOM Bindings

**Hypothesis**: Skip React re-rendering. The Vite compiler transforms `$$()` into `useRef` + `useDirectBindings` that wire effects straight to DOM nodes.

**3a: With standard memo — double work**: The $$() effect updates the DOM, then useTracked triggers a React re-render of the same component. The React diff finds DOM already correct — wasted work. Net slower due to effect setup cost.

**3b: With `memo(() => true)` — store coupling**: Prevents all React re-renders so only effects handle updates. But requires the Row to read `store.selected` directly instead of receiving `isSelected` as a prop — closures over props go stale when the component never re-renders. The Row becomes unusable outside the benchmark. Rejected as benchmark hacking.

**Alternative considered**: Per-field components (`const Label = tracked(({ item }) => <a>{item.label}</a>)`). Works for text content, not for attributes (className). With tracked() (Experiment 5), largely unnecessary.

**Verdict**: Failed. Either double-work or store-coupled components.

---

## Experiment 4: useScopedTracked (Per-Component Proxy Wrapper)

**Hypothesis**: Give each component its own proxy wrapper that routes reads to its own effect.

```tsx
function createScopedProxy<T>(target: T, effectNode: any): T {
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
  })
}
```

**Result**: Label isolation worked. But per-access save/restore during For's 1000-item iteration added significant overhead. Swap was 2.4x slower.

Also tried subscribing to ownKeys instead of wrapping arrays. But ownKeys doesn't fire on swap (element reassignment, not add/remove). Adding ownKeys bump on every array element change caused splice to fire ownKeys 999 times.

**Verdict**: Correct concept, wrong mechanism. Wrapping reads (proxy per access) is slower than wrapping renders (set currentSub once per component).

---

## Experiment 5: tracked() Component Wrapper (SUCCESS)

### The key insight

[react-tracking-approaches.md](react-tracking-approaches.md) documents "global subscriber during render" as failed approach #1, because React renders depth-first and child components overwrite the parent's subscriber.

`tracked()` IS a global subscriber during render — but it works because of one critical property: **`Component(props)` is a synchronous function call that returns JSX without rendering children.** React renders children later, in separate calls. So `currentSub` set before `Component(props)` and restored after does NOT leak into children.

This is the same problem useTracked solved with per-access proxy swaps, but solved more cheaply: O(1) save/restore per component vs O(n) per property access.

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

### What happens during a label change: old vs new

**useTracked (old)**:
1. Label signal fires → App's effect fires (createStableProxy routed Row's read to App)
2. App re-renders → For iterates 1000 items → 999 memo skips + 1 Row re-render
3. **Total**: 1 App render + 1000 memo checks + 1 Row render

**tracked() (new)**:
1. Label signal fires → Row 5's effect fires (it subscribed during its own render)
2. Row 5 re-renders
3. **Total**: 1 Row render

### Usage pattern

```tsx
const App = tracked(() => {
  const selected = store.selected  // explicit read in App's render body
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

**Why `const selected = store.selected` is in App's body**: The For callback runs inside For's render, not App's. By that point, App's `currentSub` has been restored. To subscribe App to selection changes, `store.selected` must be read where App's `currentSub` is active — in App's own render body.

**Why For is still needed**: tracked() scopes subscriptions per-component, but React still needs keyed reconciliation for structural changes. For provides this. Note: For's version-based memo mechanism (passing a `version` prop to detect item changes) becomes redundant — each tracked() Row has its own effect that fires `forceUpdate` when its data changes. For is needed only for keyed reconciliation.

**Safe on non-reactive components**: No reactive reads → zero dependencies → effect never fires → behaves as `memo()` with ~1-2μs dormant overhead. tracked() can replace both `useTracked()` and `memo()` universally.

### Why not just .map() instead of For?

Tested dropping For and using `.map()` directly. It fixed splice/push detection (iteration happens in App's render with `currentSub` active). But it reintroduced the useTracked problem — `item.label` reads during the `.map()` callback subscribe to App's effect, so label changes trigger App re-renders.

For creates a render boundary: App reads `store.data` (subscribes to structure), For iterates and passes items to Rows, each Row reads its own item fields in its own render scope.

### Core changes required

**1. $VERSION as signal** (`core.ts`, `write.ts`): `bumpVersion` writes to a signal instead of incrementing a plain number. During splice (~999 element shifts), alien-signals deduplicates: first write marks subscriber dirty, remaining ~998 are no-ops. Cost: ~0.2ms for 1000 signal writes vs ~30ms for 999 ownKeys bumps (the alternative approach from Experiment 4).

**2. Array version auto-subscribe** (`read.ts`): When the reactive proxy returns an array with an active subscriber, subscribe to the array's version signal:

```tsx
if (Array.isArray(value) && getCurrentSub()) {
  const arrayNodes = getNodes(value)
  if (arrayNodes[$VERSION]) arrayNodes[$VERSION]()
}
```

When App reads `store.data`, it automatically subscribes to "any mutation on this array." Splice, push, swap — all bump version.

**3. trackSelf on array function access** (`read.ts`): Calling `.map()`, `.forEach()`, etc. subscribes to ownKeys when there's an active subscriber.

### Bug: splice/push not triggering re-render

With tracked() + For, splice and push didn't trigger App re-renders. Tests with `console.log` in the App body passed; identical tests without it failed.

**Diagnosis**: Added effect fire counters. Passing test: `effects=1` after splice. Failing test: `effects=0` — effect never fired.

**Root cause**: App's only subscription was `store.data` (the array reference). Splice mutates in-place without changing the reference. `console.log(store.data.length)` accidentally subscribed App to the length signal (splice changes length → effect fired).

**Fix**: Core change #2 — auto-subscribing to the array's version signal when returning an array.

**Red herrings tried before diagnosing**: React bailout (Fragment key), queueMicrotask, object-based useReducer. None were the cause. Root cause found by instrumentation showing `effects=0`.

### Stale dependencies

The effect callback only runs `forceUpdate()` — no signal reads. When alien-signals re-runs the callback, it clears old deps (since the callback doesn't read signals, deps become empty). Deps are re-established during the next React render when `tracked()` sets `currentSub`.

Lifecycle: `render → deps added → signal change → deps cleared + forceUpdate → render → deps re-added`

Edge case: if two signals change between renders, the first fires the effect (deps cleared, forceUpdate dispatched), the second finds no subscriber (deps were cleared). But forceUpdate was already dispatched, so the re-render picks up both changes. No lost updates.

### Final results (apples-to-apples, same Row template, fresh store per test)

| Operation | useTracked (old) | tracked() (new) | delta |
|---|---|---|---|
| create 1000 | 57.9ms | 40.3ms | **30% faster** |
| replace all | 61.7ms | 52.0ms | **16% faster** |
| partial update | 18.0ms | 2.4ms | **7.5x faster** |
| select row | 5.6ms | 3.8ms | **32% faster** |
| swap rows | 40.6ms | 8.7ms | **4.7x faster** |
| remove row | 7.6ms | 6.0ms | **21% faster** |
| create 10000 | 759ms | 615ms | **19% faster** |
| append 1000 | 51.0ms | 55.5ms | ~same |
| clear | 10.7ms | 10.5ms | same |

Faster or equal on every operation. Zero regressions.

---

## What Ships, What Doesn't

### Ships (committed)
- **splice/pop/shift fix**: `deleteProperty` on arrays
- **$VERSION as signal**: efficient structural subscriptions
- **Array version auto-subscribe**: splice/push detection
- **trackSelf on array function access**: ownKeys on .map()/.forEach()
- **Krauset benchmark tests**: correctness + perf for both packages
- **Vite plugin CJS fix**

### Ships next
- **tracked()**: replaces `useTracked` + `createStableProxy` + `globalProxyCache` + `proxyEffectMap`

### Doesn't ship
- **DirectFor**: full DOM rebuild, broken for structural mutations
- **createView / useView**: marginal improvement, not worth the complexity
- **$$()**: double work or store-coupled components
- **useScopedTracked**: correct concept, slower than tracked()

---

## Key Lessons

1. **Wrap the render, not the reads**: Per-access currentSub swap (useTracked's proxy approach) is O(n) per property access. Per-render swap (tracked()) is O(1) per component. Both solve nested component isolation, but tracked() is cheaper.

2. **"Global subscriber during render" works when scoped to the synchronous function call**: [react-tracking-approaches.md](react-tracking-approaches.md) rejected this as approach #1 because children overwrite the parent's subscriber. tracked() avoids this because `Component(props)` returns JSX without rendering children — React renders children in separate calls.

3. **Array structural subscriptions need a version signal**: Individual index subscriptions (1000 per array) and ownKeys (fires 999x during splice) are both expensive. A version signal with alien-signals' dirty-marking deduplication fires once per batch.

4. **For creates a render boundary, not just keyed reconciliation**: Without For, `.map()` iteration happens in the parent's render scope, subscribing the parent to all child-level signals. For's render boundary is what enables per-component scoping.

5. **tracked() is safe as a universal wrapper**: Non-reactive components get `memo()` behavior with negligible overhead. No reason to keep `useTracked` alongside it.

6. **Validate causes before creating fixes**: The splice/push bug was found by adding effect fire counters, not by guessing at React bailouts or microtask timing.

7. **Benchmark methodology**: Same Row template, fresh store per test, proper cleanup, same file for JIT consistency.
