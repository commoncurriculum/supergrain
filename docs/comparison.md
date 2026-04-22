# Comparison

Supergrain isn't the only fine-grained reactive library for React. This page puts Supergrain side-by-side with the alternatives — showing both the **API** you write and the **internals** under the hood. Signal-based libraries are called out specifically so you can compare them as a group.

## Table of contents

**Supergrain**

- [Supergrain](#supergrain)

**State container libraries** — React's built-in state or a store with manual, selector-based subscriptions. No automatic per-property tracking.

- [useState](#usestate) — React built-in
- [Zustand](#zustand) — plain object store + selectors
- [Redux / RTK](#redux--rtk) — actions + reducers + selectors

**Signal-based libraries** — automatic fine-grained reactivity driven by a reactive primitive (signal, observable, atom, or proxy-tracked property). Supergrain belongs in this group.

- [MobX](#mobx) — observables + reactions + `observer()` HOC
- [Preact Signals](#preact-signals) — `signal(value)` containers
- [Jotai](#jotai) — atoms
- [Valtio](#valtio) — proxy + snapshots
- [TanStack Store](#tanstack-store) — single atom + selectors (same alien-signals primitive as Supergrain)

**Related (not React)**

- [Solid](#solid) — not a React library, but the architecture Supergrain borrows from

**Recap**

- [Summary](#summary)

## Supergrain

```typescript
// [#DOC_TEST_52](packages/doc-tests/tests/readme-core.test.ts)

interface State { count: number; user: { profile: { name: string } } }
const store = createReactive<State>({ count: 0, user: { profile: { name: 'John' } } })

// Mutate
store.count = 5

// Deep nested
store.user.profile.name = 'Bob'

// Fine-grained — only re-renders when count changes
const Counter = tracked(() => {
  return <p>{store.count}</p>
})
```

**Internals.**

Source refs: [`packages/core/src/read.ts`](https://github.com/commoncurriculum/supergrain/blob/main/packages/core/src/read.ts), [`packages/react/src/tracked.ts`](https://github.com/commoncurriculum/supergrain/blob/main/packages/react/src/tracked.ts), [`packages/core/src/batch.ts`](https://github.com/commoncurriculum/supergrain/blob/main/packages/core/src/batch.ts)

- **State shape.** Every object in the tree is wrapped in its own JavaScript Proxy, created lazily via `wrap()` on first access. Each property gets its own signal on first read. No explicit observables, no atom declarations — the reactive graph mirrors the object's shape.
- **Reactive primitive.** Signal propagation uses [alien-signals](https://github.com/stackblitz/alien-signals), the same primitive Vue Vapor is built on. Push-based updates, topological ordering, glitch-free `computed` chains — no manual scheduling.
- **Fine-grained tracking.** `tracked()` wraps the component's render in an alien-signals `effect()` scope. Proxy reads during render auto-subscribe that scope to exactly the signals they touched. When a signal fires, only the components that actually read it re-render — no selectors, no universal fan-out.
- **React bridge.** `tracked()` uses `useReducer` + alien-signals `effect()` — not `useSyncExternalStore`. The effect scope captures which signals the component read; when one fires, the reducer forces a re-render of just that component.
- **Mutation.** In-place: `store.user.profile.name = "Bob"` fires exactly one signal. No spreading, no updater functions, no snapshot layer. `batch()` groups multiple mutations into a single notification cycle.

### Footguns / Downsides

- **You have to remember `tracked()`.** Fine-grained React updates depend on wrapping components in `tracked()`; if you forget, you lose the per-component subscription behavior the library is built around. See the [README quick start](https://github.com/commoncurriculum/supergrain/blob/main/README.md#local-state--usereactive).
- **Only plain objects and arrays are reactive.** `Map`, `Set`, class instances, `Date`, and other built-ins pass through unchanged, so mutating them will not trigger re-renders. See the [FAQ](https://github.com/commoncurriculum/supergrain/blob/main/README.md#faq).
- **`batch()` is sync-only.** You can't `await` inside a batch; the library explicitly throws because batching is implemented with a global depth counter. See the [FAQ](https://github.com/commoncurriculum/supergrain/blob/main/README.md#faq).
- **Fresh props can still defeat memoization.** `tracked()` wraps components in `React.memo`, but passing fresh inline objects, arrays, or closures as props still causes prop-driven re-renders. See the [FAQ](https://github.com/commoncurriculum/supergrain/blob/main/README.md#faq).

## useState

```typescript
// [#DOC_TEST_53](packages/doc-tests/tests/readme-core.test.ts)

const [state, setState] = useState<State>({
  count: 0,
  user: { profile: { name: "John" } },
});

// Mutate
setState((prev) => ({ ...prev, count: 5 }));

// Deep nested
setState((prev) => ({
  ...prev,
  user: { ...prev.user, profile: { ...prev.user.profile, name: "Bob" } },
}));

// Fine-grained — ❌ not possible. Re-renders on ANY state change.
```

**Internals.**

Source refs: [`ReactFiberHooks.js`](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberHooks.js)

- **State shape.** State lives on the component's fiber — no store, no graph, just a pair returned from the hook.
- **Reactive primitive.** None. React compares old and new state by reference (`Object.is`); if they differ, it schedules a re-render of that component and its subtree.
- **Fine-grained tracking.** Not possible. Any change to the state object re-renders the whole component.
- **React bridge.** N/A — `useState` is built into React. Re-renders go through the normal fiber reconciliation, not through an external-store subscription.
- **Mutation.** Immutable: `setState((prev) => ({ ...prev, count: 5 }))`. Every nested field you want to change requires spreading every layer above it.

### Footguns / Downsides

- **No fine-grained updates for object state.** If one field changes, the whole component re-renders; React does not track property-level reads.
- **Deep updates get verbose fast.** React's own docs show that nested updates require copying every level above the change, and recommend flattening state or using Immer when this gets repetitive. See [Updating Objects in State](https://react.dev/learn/updating-objects-in-state).
- **Direct mutation fails silently.** Mutating an existing object in state does not trigger a render, which can leave the UI stale until some unrelated update happens. See [Updating Objects in State](https://react.dev/learn/updating-objects-in-state).

## Zustand

```typescript
// [#DOC_TEST_54](packages/doc-tests/tests/readme-core.test.ts)

const useStore = create<State>()((set) => ({
  count: 0,
  user: { profile: { name: 'John' } },
}))

// Mutate
useStore.setState({ count: 5 })

// Deep nested — manual spreading
useStore.setState(state => ({
  user: { ...state.user, profile: { ...state.user.profile, name: 'Bob' } }
}))

// Fine-grained — requires selector
const Counter = () => {
  const count = useStore(state => state.count)
  return <p>{count}</p>
}
```

**Internals.**

Source refs: [`README.md`](https://github.com/pmndrs/zustand/blob/main/README.md), [`src/vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts), [`src/traditional.ts`](https://github.com/pmndrs/zustand/blob/main/src/traditional.ts)

- **State shape.** A closure holding the state object and a `Set` of listeners. No proxy, no reactive graph — state is a plain object.
- **Reactive primitive.** None per-property. Every `setState` notifies every subscriber; fine-grained behavior comes entirely from selector equality checks, not reactive tracking.
- **Fine-grained tracking.** Selector-driven. The hook runs your selector on every change and bails out when the result matches by reference (`Object.is`). The developer writes the selector and picks the right granularity.
- **React bridge.** Each `useStore(selector)` subscribes to the listener set; when notified, it re-runs the selector and re-renders only if the result changed.
- **Mutation.** Immutable: `useStore.setState({ count: 5 })` or `useStore.setState((prev) => ({ ... }))`. `Object.assign` shallow-merges into the current state. No batching — each `setState` notifies every subscriber.

### Footguns / Downsides

- **Easy to over-subscribe.** Zustand's own README warns that reading the whole store with `const state = useBearStore()` will update the component on every state change. See the [README](https://github.com/pmndrs/zustand/blob/main/README.md#fetching-everything).
- **Selectors need discipline.** If you build objects or arrays in selectors, you often need `useShallow` or a custom equality function to avoid unnecessary re-renders. See the [README](https://github.com/pmndrs/zustand/blob/main/README.md#selecting-multiple-state-slices).
- **Deep updates are still immutable update work.** Zustand's docs explicitly say state must be updated immutably, and point to Immer for nested structures because that code gets tedious. See the [README](https://github.com/pmndrs/zustand/blob/main/README.md#first-create-a-store) and [README](https://github.com/pmndrs/zustand/blob/main/README.md#sick-of-reducers-and-changing-nested-states-use-immer).
- **Replacing state can blow away actions.** The `set` function can replace the whole store, and Zustand warns to be careful not to wipe out actions you rely on. See the [README](https://github.com/pmndrs/zustand/blob/main/README.md#overwriting-state).

## Redux / RTK

```typescript
// [#DOC_TEST_55](packages/doc-tests/tests/readme-core.test.ts)

const slice = createSlice({
  name: 'app',
  initialState: { count: 0, user: { profile: { name: 'John' } } } as State,
  reducers: {
    setCount: (state, action) => { state.count = action.payload },
    setName: (state, action) => { state.user.profile.name = action.payload },
  },
})

// Mutate — typically modeled through named actions / reducers
dispatch(setCount(5))

// Deep nested — still routed through actions / reducers
dispatch(setName('Bob'))

// Fine-grained — requires useSelector
const Counter = () => {
  const count = useSelector((state: RootState) => state.app.count)
  return <p>{count}</p>
}
```

**Internals.**

Source refs: [`createSlice.ts`](https://github.com/reduxjs/redux-toolkit/blob/main/packages/toolkit/src/createSlice.ts), [`createReducer.test.ts`](https://github.com/reduxjs/redux-toolkit/blob/main/packages/toolkit/src/tests/createReducer.test.ts), [`useSelector.ts`](https://github.com/reduxjs/react-redux/blob/master/src/hooks/useSelector.ts)

- **State shape.** Immutable state behind a reducer. Updates that change state produce new references; no-op paths can return the existing state.
- **Reactive primitive.** None per-property. Every dispatched action fans out to every subscriber; selectors bail out on reference equality.
- **Fine-grained tracking.** Selector-driven via `useSelector`. Re-runs on every dispatch; re-renders only when the returned value changes by reference.
- **React bridge.** `react-redux` subscribes each `useSelector` to store dispatches and ties into React's re-render scheduling.
- **Mutation.** Actions + reducers. RTK's `createSlice` uses Immer under the hood, so "mutations" written inside reducers are compiled to immutable updates. You can also return immutable copies directly.

### Footguns / Downsides

- **Selectors are easy to get wrong.** React Redux warns that returning a new object from `useSelector` forces a re-render by default, and that selecting the whole root state is almost always a mistake. See the [`useSelector` docs](https://react-redux.js.org/api/hooks#equality-comparisons-and-updates).
- **Hooks have edge cases.** React Redux still documents "stale props" and "zombie child" cases for hook-based selectors in some update orders. See the [usage warnings](https://react-redux.js.org/api/hooks#usage-warnings).
- **Immutable update code is still nasty without Immer.** Redux's own immutable update guide says every nesting level must be copied and updated appropriately, and shows how verbose deep updates get. See [Immutable Update Patterns](https://redux.js.org/usage/structuring-reducers/immutable-update-patterns).
- **RTK's mutating reducer syntax is context-dependent.** Redux explicitly warns that the concise `state.x = y` style is only safe inside Immer-powered reducers such as `createReducer`/`createSlice`; outside that context it really mutates state. See [Immutable Update Patterns](https://redux.js.org/usage/structuring-reducers/immutable-update-patterns#simplifying-immutable-updates-with-redux-toolkit).

## MobX

```typescript
// [#DOC_TEST_56](packages/doc-tests/tests/readme-core.test.ts)

class AppStore {
  count = 0
  user = { profile: { name: 'John' } }
  constructor() { makeAutoObservable(this) }
}
const store = new AppStore()

// Mutate
store.count = 5

// Deep nested
store.user.profile.name = 'Bob'

// Fine-grained — requires observer + makeAutoObservable ceremony
const Counter = observer(() => {
  return <p>{store.count}</p>
})
```

**Internals.** Fine-grained like Supergrain, but observability is opt-in and the graph uses MobX's own reaction pattern rather than alien-signals.

Source refs: [`docs/observable-state.md`](https://github.com/mobxjs/mobx/blob/main/docs/observable-state.md), [`docs/react-integration.md`](https://github.com/mobxjs/mobx/blob/main/docs/react-integration.md), [`useObserver.ts`](https://github.com/mobxjs/mobx/blob/main/packages/mobx-react-lite/src/useObserver.ts)

- **State shape.** Observable objects, arrays, maps, and fields, but observability is opt-in — you mark what's reactive via `observable()` / `makeAutoObservable` / decorators. `observable()` creates a separate observable object and, when proxies are enabled, returns it through a Proxy; `makeAutoObservable(this)` annotates an existing class instance. Supergrain's proxy wraps the whole tree automatically; nested objects are lazily proxied via `wrap()` on first access with no declarations.
- **Reactive primitive.** Reaction-based observer pattern. Each observable maintains an `observers_` set and propagates changes through `propagateChanged()`. Supergrain uses alien-signals — push-based, topologically ordered, glitch-free computed chains.
- **Fine-grained tracking.** `observer()` HOC runs the render inside a `Reaction` that captures observable reads and re-runs the component when any read observable changes.
- **React bridge.** `observer()` wraps components with `useSyncExternalStore` internally. Supergrain's `tracked()` uses `useReducer` + alien-signals `effect()` — no `useSyncExternalStore` snapshot.
- **Mutation.** Direct mutation is allowed (`store.count = 5`). Actions (`runInAction`, `@action`) provide batching and enforce mutation discipline.

### Footguns / Downsides

- **You have to wrap reading components.** MobX's docs say the rule of thumb is to apply `observer` to all components that read observable data; forgetting it is the most common reason things don't re-render. See [React integration](https://mobx.js.org/react-integration.html#always-read-observables-inside-observer-components) and [Troubleshooting](https://mobx.js.org/react-integration.html#troubleshooting).
- **Tracking can break when reads happen in the wrong place.** MobX warns to read observables inside `observer` components, not before them, and not to pass observables into non-`observer` children without converting them first. See [React integration](https://mobx.js.org/react-integration.html#dont-pass-observables-into-components-that-arent-observer).
- **Some React features are a worse fit for local observables.** MobX recommends not reaching for local observable state too quickly because it can theoretically lock you out of some Suspense behavior. See [You might not need locally observable state](https://mobx.js.org/react-integration.html#you-might-not-need-locally-observable-state).
- **Props and computed values can need manual syncing.** MobX documents that component props are not themselves observable, so computed values derived from props may require explicit syncing into local observable state. See [deriving computeds from props](https://mobx.js.org/react-integration.html#computed-props).

## Preact Signals

```ts
import { signal } from "@preact/signals-react";
// With the Babel transform enabled (recommended). Without it,
// call `useSignals()` from `@preact/signals-react/runtime`.

const count = signal(0);
const user = signal({ profile: { name: "John" } });

// Mutate
count.value = 5;

// Deep nested — replace the whole object, or nest signals per field
user.value = { ...user.value, profile: { name: "Bob" } };

// Fine-grained — component subscribes to any signal it reads
const Counter = () => <p>{count.value}</p>;
```

**Internals.**

Source refs: [`packages/react/README.md`](https://github.com/preactjs/signals/blob/main/packages/react/README.md), [`packages/react/runtime/src/index.ts`](https://github.com/preactjs/signals/blob/main/packages/react/runtime/src/index.ts)

- **State shape.** Individual `signal(value)` containers. Each reactive unit is its own object; nested state requires nested signals or replacing the whole object on update. Supergrain's proxy returns bare property values (`store.user.name` is a string, not `signal.value`) and creates signals lazily under the hood.
- **Reactive primitive.** Preact's own signal runtime. Reads go through `signal.value`, a property getter that registers the current effect as a subscriber.
- **Fine-grained tracking.** The component's render scope subscribes to every signal it `.value`-accesses; when one fires, the component re-renders. If you pass a signal directly into JSX instead of reading `.value`, the React adapter can update the bound text node directly.
- **React bridge.** `@preact/signals-react` tracks a 32-bit version counter per subscribed scope and notifies React through `useSyncExternalStore` when it changes. (A Babel transform variant auto-injects the subscription.)
- **Mutation.** Direct write to `.value`: `count.value = 5`. Deep nested changes require replacing the whole object or nesting signals per field.

### Footguns / Downsides

- **You pay the `.value` tax.** Signals are explicit containers; reads and writes go through `.value`, which is more ceremony than plain object property access. See the [Signals guide](https://preactjs.com/guide/v10/signals/#introduction).
- **Object and array state often means replacement, not deep mutation tracking.** The official examples update list/object-like values by assigning a new value to the signal, not by tracking nested fields automatically. See the [todo example](https://preactjs.com/guide/v10/signals/#usage-example).
- **Computed values are lazy.** Preact documents that computed signals do not recompute until something reads them, which is great for perf but can surprise people expecting eager propagation. See [Reacting to signals outside of components](https://preactjs.com/guide/v10/signals/#reacting-to-signals-outside-of-components).
- **Effects require cleanup discipline.** The docs explicitly warn to clean up effects or the app will consume more memory than needed. See [Reacting to signals outside of components](https://preactjs.com/guide/v10/signals/#reacting-to-signals-outside-of-components).

## Jotai

```ts
import { atom, useAtomValue, useSetAtom } from "jotai";

const countAtom = atom(0);
const userAtom = atom({ profile: { name: "John" } });

// Mutate (inside a component or event handler)
const setCount = useSetAtom(countAtom);
setCount(5);

// Deep nested — manual spreading, per atom
const setUser = useSetAtom(userAtom);
setUser((prev) => ({ ...prev, profile: { name: "Bob" } }));

// Fine-grained — one subscription per atom
const Counter = () => <p>{useAtomValue(countAtom)}</p>;
```

**Internals.**

Source refs: [`README.md`](https://github.com/pmndrs/jotai/blob/main/README.md), [`src/react/useAtomValue.ts`](https://github.com/pmndrs/jotai/blob/main/src/react/useAtomValue.ts)

- **State shape.** Decomposed into atoms. Each atom is a separate reactive unit. No shared object tree — you wire atoms together with derived atoms. Supergrain is the inverse shape: one proxy, signals created lazily per property, memory that scales with object complexity rather than atom count.
- **Reactive primitive.** Atom graph. Derived atoms depend on primitive atoms; a context-scoped store tracks dependencies between them.
- **Fine-grained tracking.** One subscription per atom. `useAtomValue(countAtom)` subscribes only to that atom; only components using it re-render when it changes.
- **React bridge.** `useAtomValue` is backed by `useReducer` + `useEffect`; each hook subscribes to a single atom via `store.sub(atom, callback)`.
- **Mutation.** Immutable updaters per atom: `setUser((prev) => ({ ...prev, name: "Bob" }))`. Nested state either lives in one coarse atom (lose fine-grained updates) or is decomposed into per-field atoms (more memory, more wiring).

### Footguns / Downsides

- **Atom identity matters.** Jotai's docs warn that creating atoms inline without memoization can cause infinite loops because referential equality is part of the model. See [`useAtom`](https://jotai.org/docs/core/use-atom).
- **You can still get extra React renders.** Jotai explicitly notes that an extra render without a commit is expected because React may invoke components more than once. See [`useAtom`](https://jotai.org/docs/core/use-atom).
- **Large objects push you toward more utilities and decomposition.** Jotai's "Large objects" recipe introduces `focusAtom`, `splitAtom`, and `selectAtom` specifically to avoid listening to all changes on one big object atom. See [Large objects](https://jotai.org/docs/recipes/large-objects).
- **Deep immutable updates do not disappear.** If you keep nested state inside one object atom, updates still go through immutable replacement/updater functions.

## Valtio

```ts
import { proxy, useSnapshot } from "valtio";

const state = proxy({ count: 0, user: { profile: { name: "John" } } });

// Mutate
state.count = 5;

// Deep nested
state.user.profile.name = "Bob";

// Fine-grained — useSnapshot tracks which properties the render reads
const Counter = () => {
  const snap = useSnapshot(state);
  return <p>{snap.count}</p>;
};
```

**Internals.** Closest to Supergrain on the **API axis** — also a proxy, also allows direct mutation with no observable declarations. Where it diverges is the React bridge: an immutable snapshot layer wrapped in a render-tracking proxy.

Source refs: [`README.md`](https://github.com/pmndrs/valtio/blob/main/README.md), [`src/react.ts`](https://github.com/pmndrs/valtio/blob/main/src/react.ts), [`tests/basic.test.tsx`](https://github.com/pmndrs/valtio/blob/main/tests/basic.test.tsx)

- **State shape.** Proxy wraps the whole object tree (like Supergrain). Nested objects are auto-proxied on mutation.
- **Reactive primitive.** Property-access tracking via the `proxy-compare` library. `useSnapshot` creates an immutable snapshot on each update and wraps it in a tracking proxy to detect which properties were read during render.
- **Fine-grained tracking.** The tracking proxy records every property accessed during render; the component re-renders when any of those properties changes in a future snapshot.
- **React bridge.** `useSnapshot` subscribes via `useSyncExternalStore`. Supergrain skips the snapshot layer entirely — reads go through the live proxy, tracked by alien-signals.
- **Mutation.** Direct mutation allowed: `state.count = 5`, `state.user.profile.name = "Bob"`. The React path rebuilds snapshots and re-runs property-access comparison on updates. Supergrain's writes are in-place and `batch()` groups them into a single notification cycle.

### Footguns / Downsides

- **Broad reads broaden subscriptions.** Valtio's gotchas page says that if you read `snap.obj` instead of `snap.obj.count`, the component will re-render on any change inside `obj`. See [Some gotchas](https://valtio.dev/docs/how-tos/some-gotchas).
- **Manual rerender control is real complexity, not just theory.** Valtio has a dedicated guide for manually avoiding rerenders with `subscribe`, local state, or `useSyncExternalStore`, which is a sign that the default mental model is easy to over-subscribe with. See [How to avoid rerenders manually](https://valtio.dev/docs/how-tos/how-to-avoid-rerenders-manually).
- **`state` vs `snap` is a real footgun.** The docs explicitly say `snap` should be used in render and `state` in callbacks/effects; mixing them up is a common source of confusion. See [Some gotchas](https://valtio.dev/docs/how-tos/some-gotchas).
- **Controlled inputs can need special handling.** Valtio documents that controlled inputs may lose caret position unless you opt into `{ sync: true }`. See [Some gotchas](https://valtio.dev/docs/how-tos/some-gotchas#controlled-inputs-may-lose-caret-position-without-sync-true).

## TanStack Store

```ts
import { Store, useSelector } from "@tanstack/react-store";

const store = new Store({ count: 0, user: { profile: { name: "John" } } });

// Mutate — immutable updater, always replaces the whole value
store.setState((prev) => ({ ...prev, count: 5 }));

// Deep nested — manual spreading through the updater
store.setState((prev) => ({
  ...prev,
  user: { ...prev.user, profile: { ...prev.user.profile, name: "Bob" } },
}));

// Fine-grained — via selector, compared with === (or custom compare)
const Counter = () => {
  const count = useSelector(store, (s) => s.count);
  return <p>{count}</p>;
};
```

**Internals.** Closest to Supergrain on the **reactive-primitive axis** — both libraries sit on the same reactive graph algorithm. TanStack's `packages/store/src/alien.ts` opens with:

```ts
/* eslint-disable */
// Adapted from Alien Signals
// https://github.com/stackblitz/alien-signals/
```

TanStack forked and vendored alien-signals; Supergrain imports it from npm. Below that shared graph, the two libraries look very different:

Source refs: [`packages/store/src/alien.ts`](https://github.com/TanStack/store/blob/main/packages/store/src/alien.ts), [`packages/store/src/store.ts`](https://github.com/TanStack/store/blob/main/packages/store/src/store.ts), [`packages/store/src/atom.ts`](https://github.com/TanStack/store/blob/main/packages/store/src/atom.ts), [`packages/react-store/src/useSelector.ts`](https://github.com/TanStack/store/blob/main/packages/react-store/src/useSelector.ts)

- **State shape.** `Store<T>` wraps a **single** `Atom<T>` holding the whole state object. Supergrain wraps the whole tree in a proxy and creates a signal per property lazily, so reactive granularity is per-field rather than per-store.
- **Reactive primitive.** Same alien-signals graph — `link(dep, sub, version)` dependency tracking, `ReactiveFlags` bitfield, `propagate` / `checkDirty` / `shallowPropagate` pipeline.
- **Fine-grained tracking.** Selector-driven. Every `setState` notifies every subscriber; `useSelector` runs its selector and uses the `compare` option (default `===`) to bail out of the re-render. Supergrain's `tracked()` wraps render in an alien-signals `effect()` scope, so only signals the component actually read trigger a re-render — no universal fan-out.
- **React bridge.** `useSyncExternalStoreWithSelector` from `use-sync-external-store/shim/with-selector`. Supergrain uses `useReducer` + alien-signals `effect()` — it benchmarked `useSyncExternalStore` for per-item subscriptions during its optimization pass and rejected it at 74% slower for row-level work. TanStack's single-atom + selector model sidesteps that cost because there's only one `useSyncExternalStore` subscription per `useSelector` call, not per item.
- **Mutation.** Immutable updater: `store.setState((prev) => ({ ...prev, count: 5 }))`. Deep nested changes require spreading every layer. Supergrain's writes are in-place: `store.user.profile.name = "Bob"` fires exactly one signal.
- **Derived / async.** First-class computed atoms (`createAtom((prev) => fn(prev))`) and async atoms (`createAsyncAtom` returns a discriminated-union state atom — `{ status: 'pending' }`, `{ status: 'done', data }`, or `{ status: 'error', error }`). Supergrain has `useComputed` for derived values; async is user-land (drive state into the store from an effect).

Full research notes in `notes/comparisons/tanstack-store.md`.

### Footguns / Downsides

- **Granularity still depends on writing selectors correctly.** TanStack Store's primary React API is `useSelector`; if you omit the selector, the docs say you subscribe to the whole value. See [`useSelector`](https://tanstack.com/store/latest/docs/framework/react/reference/functions/useSelector).
- **Nested writes are immutable update code.** Even the quick-start examples update state with object spreads inside `setState`, so deep changes still mean copying through the path you changed. See the [React quick start](https://tanstack.com/store/latest/docs/framework/react/quick-start).
- **No automatic proxy-style property tracking.** You get fine-grained re-renders through manual selector boundaries, not by reading from a live reactive object tree.

## Solid

Solid isn't a React library, but it's the architecture Supergrain borrows from: proxy-wrapped stores where each property is backed by a signal, with fine-grained DOM updates driven by the compiler. Solid's compiler creates a direct signal→DOM mapping, which eliminates virtual-DOM diffing entirely.

Source refs: [`README.md`](https://github.com/solidjs/solid/blob/main/README.md), [`packages/solid/store/src/store.ts`](https://github.com/solidjs/solid/blob/main/packages/solid/store/src/store.ts)

Supergrain can't rely on compilation — React owns the render cycle — so `tracked()` exists to bridge signals into React's top-down reconciliation. Each tracked component runs inside its own signal-tracking scope; when a signal it read fires, only that component re-renders. This is the per-component signal scoping that makes fine-grained reactivity possible in React without a Babel transform or `useSyncExternalStore` snapshot.

### Footguns / Downsides

- **It is not a React library.** The architectural lessons transfer, but the programming model assumes Solid's renderer and store/runtime semantics, not React's component update model.
- **Tracking only exists inside tracking scopes.** Solid's store docs explicitly show that reading store values outside a tracked scope does not establish dependencies, which can surprise React users expecting subscription semantics everywhere. See [Stores](https://docs.solidjs.com/concepts/stores#accessing-store-values).
- **Writes go through `setStore`, not plain assignment.** Solid's default store API separates reads from writes and uses setter/path syntax; that is a different ergonomics tradeoff from direct mutable-looking APIs. See [`createStore`](https://docs.solidjs.com/reference/store-utilities/create-store) and [Stores](https://docs.solidjs.com/concepts/stores#modifying-store-values).

## Summary

Signal-based React libraries cluster around a few internal patterns:

| Library        | Reactive unit                        | React bridge                                       | Nested state                         |
| -------------- | ------------------------------------ | -------------------------------------------------- | ------------------------------------ |
| MobX           | Explicit observables                 | `observer()` + `useSyncExternalStore`              | `makeAutoObservable` or `observable` |
| Preact Signals | `signal(value)` containers           | Version tracking + `useSyncExternalStore`          | Nested signals or replace-on-update  |
| Jotai          | Atoms                                | `useAtomValue` (`useReducer` + `useEffect`)        | Atomic decomposition                 |
| Valtio         | Proxy + snapshots                    | `useSnapshot` + `useSyncExternalStore`             | Auto-proxied on mutation             |
| TanStack Store | Single atom (forked alien-signals)   | `useSelector` + `useSyncExternalStoreWithSelector` | Spread through `setState`            |
| Supergrain     | Proxy + alien-signals (per-property) | `tracked()` (`useReducer` + `effect()`)            | Auto-proxied via `wrap()`            |

Supergrain's specific combination:

- **alien-signals** for propagation (push-based, topological, glitch-free computed chains) — shared with TanStack Store, which forks the same algorithm.
- **Lazy proxy wrapping of the whole tree** — no explicit observables, no atom declarations, no snapshot layer. Each property becomes its own signal on first access.
- **`tracked()` for per-component subscription scoping** — `useReducer` + alien-signals `effect()`, not `useSyncExternalStore`. Only signals a component actually reads during render trigger its re-renders.

The result is plain `store.user.name = "x"` reads and writes, automatic fine-grained re-renders, and in-place updates that don't pay a snapshot or immutable-spread cost.
