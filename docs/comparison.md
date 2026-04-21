# Comparison

Supergrain isn't the only fine-grained reactive library for React. This page puts Supergrain side-by-side with the alternatives — showing both the **API** you write and the **internals** under the hood. Signal-based libraries are called out specifically so you can compare them as a group.

## Table of contents

**Supergrain**

- [Supergrain](#supergrain)

**State container libraries** — React's built-in state or a store with manual, selector-based subscriptions. No automatic per-property tracking.

- [useState](#usestate) — React built-in
- [Zustand](#zustand) — plain object store + selectors
- [Redux / RTK](#redux--rtk) — actions + reducers + selectors

**Signal-based libraries** — automatic fine-grained reactivity driven by a reactive primitive (signal, observable, atom, or proxy-tracked property). This is the group the reviewer was asking about; Supergrain belongs here too.

- [MobX](#mobx) — proxy + observables + `observer()` HOC
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

**Internals.** A single JavaScript Proxy wraps the entire object tree. Nested objects are lazily proxied via `wrap()` on first access — no explicit observables, no atom declarations. Signal propagation uses [alien-signals](https://github.com/stackblitz/alien-signals) (the same primitive Vue Vapor is built on) for push-based updates with topological ordering and glitch-free `computed` chains. The React bridge is `tracked()`, which uses `useReducer` + an alien-signals `effect()` scope — not `useSyncExternalStore`. Each tracked component subscribes only to the signals it actually read during render, so re-renders are per-component and fine-grained.

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

**Internals.** React's built-in state hook. State lives on the component's fiber; `setState` schedules a re-render of that component (and its subtree). There's no reactive graph and no per-property subscription — any change to the state object re-renders the whole component.

## Zustand

```typescript
// [#DOC_TEST_54](packages/doc-tests/tests/readme-core.test.ts)

const useStore = create<State>()((set) => ({
  count: 0,
  user: { profile: { name: 'John' } },
}))

// Mutate
set({ count: 5 })

// Deep nested — manual spreading
set(state => ({
  user: { ...state.user, profile: { ...state.user.profile, name: 'Bob' } }
}))

// Fine-grained — requires selector
const Counter = () => {
  const count = useStore(state => state.count)
  return <p>{count}</p>
}
```

**Internals.** Zustand's core is a closure holding the state object and a `Set` of listeners; each `setState` does `Object.assign` + an `Object.is` change check, then notifies every listener. Fine-grained re-renders are selector-driven: the hook runs your selector on every dispatched change and bails out when the selector result matches by reference. There's no automatic per-property tracking — the developer writes the selector and picks the right granularity — and no batching (each `setState` notifies every subscriber).

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

// Mutate — need a reducer for each mutation
dispatch(setCount(5))

// Deep nested — need a reducer for each path
dispatch(setName('Bob'))

// Fine-grained — requires useSelector
const Counter = () => {
  const count = useSelector((state: RootState) => state.app.count)
  return <p>{count}</p>
}
```

**Internals.** Immutable store behind an action → reducer → new-state pipeline, with action objects flowing through middleware and DevTools on every dispatch. `react-redux`'s `useSelector` re-runs on every dispatch and re-renders when the returned value changes by reference equality. RTK's `createSlice` uses Immer under the hood, so "mutations" inside reducers are compiled to immutable updates. Like Zustand, fine-grained tracking is selector-driven, not automatic — and action history plus Immer drafts make RTK the heaviest option on memory.

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

**Internals.** The closest architectural neighbor — also proxy-based, also fine-grained. Three things differ from Supergrain:

- **Observable declaration.** MobX needs explicit `observable()` / `makeAutoObservable` / decorators to mark what's reactive. Supergrain wraps the whole tree automatically; nested objects are lazily proxied via `wrap()` on first access.
- **Dependency tracking.** MobX uses a reaction-based observer pattern — each observable maintains an `observers_` set and propagates changes through `propagateChanged()`. Supergrain uses alien-signals for propagation with topological ordering and glitch-free computed chains.
- **React bridge.** MobX's `observer()` HOC wraps components with `useSyncExternalStore` and runs the render inside a `Reaction`. Supergrain's `tracked()` uses `useReducer` + an alien-signals `effect()` scope — no `useSyncExternalStore` snapshot.

## Preact Signals

```ts
import { signal } from "@preact/signals-react";

const count = signal(0);
const user = signal({ profile: { name: "John" } });

// Mutate
count.value = 5;

// Deep nested — replace the whole object, or nest signals per field
user.value = { ...user.value, profile: { name: "Bob" } };

// Fine-grained — component subscribes to any signal it reads
const Counter = () => <p>{count.value}</p>;
```

**Internals.** State lives in individual `signal(value)` containers. Reads go through `signal.value`, a property getter. `@preact/signals-react` bridges signals into React by tracking a 32-bit version counter per subscribed scope and notifying React through `useSyncExternalStore` when it changes.

Supergrain doesn't use value containers. Reads are bare property access (`store.user.name` returns a string, not `signal.value`); the proxy creates a signal for that property on first access and subscribes whatever effect is currently running. A propagation-only swap to `@preact/signals-core` was evaluated and rejected — a micro-benchmark that showed preact 2–4× faster on reads turned out not to be running reads inside an `effect()`, so it was measuring V8's property-getter optimization, not signal performance. In a real reactive context the signal library is not the bottleneck; proxy overhead and React reconciliation are.

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

**Internals.** State is decomposed into atoms. Each atom is a reactive unit (~72 bytes of state: dependency map, version, value, error, pending set). `useAtomValue` is backed by `useReducer` + `useEffect`; it subscribes to a single atom via `store.sub()`. Nested state either lives in one coarse atom (lose fine-grained updates) or is decomposed down to per-field atoms (more memory, more wiring).

Supergrain is the inverse shape: one proxy for the whole tree, with signals created lazily per property as you read them. Memory scales with object complexity, not atom count. Deep updates are in-place — `store.user.profile.address.lat = 42` — instead of Jotai's spread-everything pattern.

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

**Internals.** The closest Supergrain neighbor on raw architecture — also a proxy, also allows direct mutation. The difference is the React bridge. `useSnapshot(state)` creates an immutable snapshot on each update and wraps it in a tracking proxy (via the `proxy-compare` library) to detect which properties were read during render; the subscription runs through `useSyncExternalStore`. Reads are very fast (frozen plain objects), but every update pays a snapshot-regeneration cost that walks the state structure, and there's no automatic batching — multiple mutations trigger multiple snapshot cycles.

Supergrain skips the snapshot layer. Reads go through the live proxy tracked by alien-signals, writes are in-place, and `batch()` groups multiple mutations into a single notification cycle.

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

**Internals.** Architecturally the closest relative to Supergrain — both libraries sit on the same reactive graph algorithm. TanStack's `packages/store/src/alien.ts` opens with:

```ts
/* eslint-disable */
// Adapted from Alien Signals
// https://github.com/stackblitz/alien-signals/
```

Same `link(dep, sub, version)` dependency tracking, same `ReactiveFlags` bitfield, same `propagate` / `checkDirty` / `shallowPropagate` pipeline. TanStack forked and vendored it; Supergrain imports `alien-signals` from npm.

The differences are everything wrapped around the graph:

- **State shape.** `Store<T>` wraps a **single** `Atom<T>` holding the whole state object. Changes go through `setState((prev) => next)` — an immutable updater that replaces the value. Supergrain wraps the whole tree in a proxy and creates a signal per property lazily, so `store.user.name = "Bob"` is an in-place mutation that fires exactly one signal.
- **Fine-grained tracking.** TanStack is selector-driven: every `setState` notifies every subscriber, and `useSelector` runs its selector and uses the `compare` option (default `===`) to bail out of the re-render. Supergrain's `tracked()` wraps render in an alien-signals `effect()` scope so only signals the component actually read trigger a re-render — there's no universal fan-out.
- **React bridge.** TanStack uses `useSyncExternalStoreWithSelector` from `use-sync-external-store/shim/with-selector`. Supergrain uses `useReducer` + alien-signals `effect()`. Supergrain benchmarked `useSyncExternalStore` for per-item subscriptions during its optimization pass and rejected it — 74% slower than the current bridge for row-level work. TanStack's single-atom + selector model sidesteps that cost because there's only one `useSyncExternalStore` subscription per `useSelector` call, not per item.
- **Derived / async.** TanStack has first-class computed atoms (`createAtom((prev) => fn(prev))`) and async atoms (`createAsyncAtom` returns a discriminated-union state atom — `{ status: 'pending' }`, `{ status: 'done', data }`, or `{ status: 'error', error }`). Supergrain has `useComputed` for derived values; async is user-land (drive state into the store from an effect).

Full research notes in `notes/comparisons/tanstack-store.md`.

## Solid

Solid isn't a React library, but it's the architecture Supergrain borrows from: proxy-wrapped stores where each property is backed by a signal, with fine-grained DOM updates driven by the compiler. Solid's compiler creates a direct signal→DOM mapping, which eliminates virtual-DOM diffing entirely.

Supergrain can't rely on compilation — React owns the render cycle — so `tracked()` exists to bridge signals into React's top-down reconciliation. Each tracked component runs inside its own signal-tracking scope; when a signal it read fires, only that component re-renders. This is the per-component signal scoping that makes fine-grained reactivity possible in React without a Babel transform or `useSyncExternalStore` snapshot.

## Summary

Signal-based React libraries cluster around a few internal patterns:

| Library        | Reactive unit                        | React bridge                                       | Nested state                  |
| -------------- | ------------------------------------ | -------------------------------------------------- | ----------------------------- |
| MobX           | Explicit observables                 | `observer()` + `useSyncExternalStore`              | Requires `observable()` calls |
| Preact Signals | `signal(value)` containers           | Version tracking + `useSyncExternalStore`          | Nested signals or opt-in deep |
| Jotai          | Atoms                                | `useAtomValue` (`useReducer` + `useEffect`)        | Atomic decomposition          |
| Valtio         | Proxy + snapshots                    | `useSnapshot` + `useSyncExternalStore`             | Auto-proxied on mutation      |
| TanStack Store | Single atom (forked alien-signals)   | `useSelector` + `useSyncExternalStoreWithSelector` | Spread through `setState`     |
| Supergrain     | Proxy + alien-signals (per-property) | `tracked()` (`useReducer` + `effect()`)            | Auto-proxied via `wrap()`     |

Supergrain's specific bets: **alien-signals** for propagation (push-based, topological, glitch-free computed chains), **lazy proxy wrapping of the whole tree** (no explicit observables, no atom declarations), and **`tracked()` for per-component subscription scoping** (no snapshot layer, no `useSyncExternalStore`). The result is plain `store.user.name = "x"` reads and writes, automatic fine-grained re-renders, and in-place updates that don't pay a snapshot or immutable-spread cost.
