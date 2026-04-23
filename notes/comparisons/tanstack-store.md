# TanStack Store Comparison

> **Status:** Reference analysis. TanStack Store is the closest architectural relative on the reactive-primitive axis — both libraries sit on alien-signals. The differences are in state shape, mutation model, and React bridge.
>
> **Source reviewed:** Cloned `github.com/TanStack/store@main` (shallow) on 2026-04-21. Code blocks below are verbatim from that snapshot with interior elisions marked `// ...`; indentation may be normalized. Each code block carries a file:line citation for the full text.

## Architecture at a glance

| Aspect                | TanStack Store                                                          | Supergrain                                                             |
| --------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| State shape           | `Store<T>` wraps a single `Atom<T>` holding the whole value             | Proxy wraps the whole object tree; signals created lazily per property |
| Reactive primitive    | Forked alien-signals, inlined as `packages/store/src/alien.ts`          | Imports alien-signals from npm                                         |
| Change detection      | `Object.is` default, overridable via `options.compare`                  | Per-property signal identity (alien-signals internals)                 |
| Mutation model        | Immutable updater: `setState((prev) => next)`                           | In-place mutation: `store.count = 5`                                   |
| Fine-grained tracking | Selector-driven: `useSelector(store, (s) => s.count)` + compare bailout | Automatic via proxy traps inside `tracked()` render scope              |
| React bridge          | `useSyncExternalStoreWithSelector`                                      | `useReducer` + alien-signals `effect()`                                |
| Derived state         | Computed atoms: `createAtom((prev) => fn(prev))`                        | `useComputed(() => expr)` wrapping alien-signals `computed`            |
| Batching              | `batch(fn)` counter + `flush()` queue                                   | `batch(fn)` from `@supergrain/kernel` (same shape)                     |
| Async support         | `createAsyncAtom` returns a discriminated-union status atom             | No first-class async primitive                                         |

## Core internals (verbatim source)

### The reactive graph is a fork of alien-signals

`packages/store/src/alien.ts:1-3`:

```ts
/* eslint-disable */
// Adapted from Alien Signals
// https://github.com/stackblitz/alien-signals/
```

The file exports `createReactiveSystem({ update, notify, unwatched })` returning `{ link, unlink, propagate, checkDirty, shallowPropagate }`. The structure mirrors alien-signals: doubly-linked subscribers (`prevSub/nextSub/prevDep/nextDep`), a `version` counter on each `Link`, and a `ReactiveFlags` bitflag enum (`None=0, Mutable=1, Watching=2, RecursedCheck=4, Recursed=8, Dirty=16, Pending=32`).

So both libraries sit on the same reactive graph algorithm. Supergrain imports `alien-signals` from npm; TanStack forked it and vendored it.

### State lives in a single atom

`packages/store/src/store.ts:15-45`:

```ts
export class Store<T, TActions extends StoreActionMap = never> {
  private atom: Atom<T>;
  public readonly actions!: TActions;
  // ...
  constructor(valueOrFn: T | ((prev?: T) => T), actionsFactory?: StoreActionsFactory<T, TActions>) {
    this.atom = createAtom(valueOrFn as T | ((prev?: NoInfer<T>) => T)) as Atom<T>;
    // ...
  }
  public setState(updater: (prev: T) => T) {
    this.atom.set(updater);
  }
  public get state() {
    return this.atom.get();
  }
  // ...
}
```

`Store<T>` wraps **one** atom containing the entire state object. There's no per-property signal; the whole state is one value that flows through `setState((prev) => next)`.

### Mutation fires propagate → shallowPropagate → flush

`packages/store/src/atom.ts:249-261` (the `set()` path on a mutable atom):

```ts
(atom as unknown as Atom<T>).set = function (valueOrFn: T | ((prev: T) => T)): void {
  if (atom._update(valueOrFn)) {
    const subs = atom.subs;
    if (subs !== undefined) {
      propagate(subs);
      shallowPropagate(subs);
      flush();
    }
  }
};
```

`_update` compares old vs new via `options?.compare ?? Object.is` and only notifies when the value actually changed. `propagate` walks the subscriber graph and queues pending effects; `shallowPropagate` marks dirty; `flush` drains the queue.

### Batching

`packages/store/src/atom.ts:60-71`:

```ts
let batchDepth = 0;

export function batch(fn: () => void) {
  try {
    ++batchDepth;
    fn();
  } finally {
    if (!--batchDepth) {
      flush();
    }
  }
}
```

`flush()` bails early when `batchDepth > 0` and drains `queuedEffects` otherwise. Same semantics as Supergrain's `batch()`.

### Subscribe creates an internal effect

`packages/store/src/atom.ts:170-187`:

```ts
subscribe(observerOrFn: Observer<T> | ((value: T) => void)) {
  const obs = toObserver(observerOrFn)
  const observed = { current: false }
  const e = effect(() => {
    atom.get()
    if (!observed.current) {
      observed.current = true
    } else {
      obs.next?.(atom._snapshot)
    }
  })

  return {
    unsubscribe: () => {
      e.stop()
    },
  }
}
```

`atom.subscribe` wraps the observer in an alien-style `effect()`. On initial run the effect reads `atom.get()` (which links the effect as a subscriber) and flips `observed.current` without calling the observer — so subscribers don't fire on first subscription. Subsequent invocations call `obs.next?.(atom._snapshot)`.

### React adapter uses useSyncExternalStoreWithSelector

`packages/react-store/src/useSelector.ts` (line 2 import + lines 19-67):

```ts
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";

function defaultCompare<T>(a: T, b: T) {
  return a === b;
}

export function useSelector<TSource, TSelected = NoInfer<TSource>>(
  source: SelectionSource<TSource>,
  selector: (snapshot: TSource) => TSelected = (s) => s as unknown as TSelected,
  options?: UseSelectorOptions<TSelected>,
): TSelected {
  const compare = options?.compare ?? defaultCompare;

  const subscribe: SyncExternalStoreSubscribe = useCallback(
    (handleStoreChange) => {
      const { unsubscribe } = source.subscribe(handleStoreChange);
      return unsubscribe;
    },
    [source],
  );

  const getSnapshot = useCallback(() => source.get(), [source]);

  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getSnapshot, selector, compare);
}
```

This is the React bridge. Every setState fires every subscriber; the selector runs in each subscribed hook and `useSyncExternalStoreWithSelector` uses the `compare` function (default `===`) to decide whether the returned value actually changed and a re-render is needed.

`useStore` is now deprecated — just an alias for `useSelector`. There's also an experimental `_useStore` tuple hook that returns `[selected, actionsOrSetState]`.

## Comparison with Supergrain

### Both are built on alien-signals

The reactive graph itself — the `link`/`propagate`/`checkDirty`/`shallowPropagate` machinery, the `ReactiveFlags` bitfield, the doubly-linked subscriber list — is **the same algorithm** in both libraries. TanStack forked and inlined it; Supergrain imports it. Any claim that "alien-signals gives push-based updates with topological ordering and glitch-free computed chains" applies equally to TanStack Store.

What differs is everything wrapped around the graph.

### State shape: one atom vs. whole-tree proxy

TanStack's `Store<T>` holds a single atom carrying the whole state object. When any property changes, you replace the whole value:

```ts
setState((prev) => ({ ...prev, user: { ...prev.user, name: "Bob" } }));
```

Supergrain wraps the whole tree in a proxy and creates a signal per property on first access. The store isn't one reactive node — it's a lazy graph that mirrors the object's shape, which means:

- `store.user.name = 'Bob'` is an in-place mutation that fires exactly one signal.
- No spreading, no updater function, no intermediate copies.

### Fine-grained tracking: selectors vs. proxy reads

TanStack's fine-grained tracking is selector-based. `useSelector(store, (s) => s.count)` runs the selector on every subscriber notification and uses `===` (or the `compare` option) to decide whether to re-render. Every subscriber fires on every `setState`, regardless of which field changed — the bailout happens in the selector.

Supergrain's `tracked()` wraps component render in an alien-signals `effect()` scope. Reads through the proxy auto-subscribe that scope to the exact signals they touched. Only signals that actually changed trigger their subscribers — there's no universal fan-out.

### React bridge: useSyncExternalStore vs. useReducer + effect

TanStack goes through `useSyncExternalStoreWithSelector`, which is the canonical React API for external stores. This means every update follows React's snapshot discipline: `getSnapshot()` must return a stable value, all subscribers get notified, each selector re-runs, and React decides whether to re-render from the compare result.

Supergrain uses `useReducer` + alien-signals `effect()`. The effect scope captures exactly which signals the component read; when one fires, the reducer forces a re-render of just that component. No `getSnapshot`, no selector bailout, no universal subscriber list.

See `notes/architecture/react-adapter-architecture.md`:

> The actual implementation in `tracked()` (formerly `useTracked`) uses `useReducer` + `effect()` from `@supergrain/kernel` rather than this `useSyncExternalStore` pattern.

And `notes/failed-approaches/react-performance-optimization-attempts.md`:

> | useSyncExternalStore | 1161ms | 74% slower | Wrong tool |
> ...
> `useSyncExternalStore` is for global app state, not per-item subscriptions.

Supergrain benchmarked `useSyncExternalStore` for per-item subscriptions during the optimization pass and rejected it — 74% slower than the current `useReducer` + `effect()` bridge for row-level subscriptions. TanStack's "one store, selector bailout" model sidesteps this because there's only ever one `useSyncExternalStore` subscription per `useSelector` call, not per item.

### Mutation: immutable updater vs. in-place

TanStack requires `setState((prev) => next)`. If you want nested updates you spread, Immer-style helpers are not built in.

Supergrain: `store.user.profile.name = 'Bob'`. In-place, synchronous, per-property.

### Derived state

TanStack: pass a function to `createAtom(fn)`; the returned atom is readonly and recomputes when its deps change. Flags track `Dirty` / `Pending` through the same reactive graph.

Supergrain: `useComputed(() => expr, deps?)` wraps alien-signals `computed()` inside a `useMemo`. Same underlying algorithm; different surface.

### Async

TanStack ships `createAsyncAtom(() => Promise<T>)` returning an atom whose value is `{ status: 'pending' } | { status: 'done', data } | { status: 'error', error }`. Supergrain has no first-class async primitive — you'd drive state into the store from an effect.

## When to choose which

**TanStack Store** fits well when:

- You're already in the TanStack ecosystem (Query, Router, Table) — it's the shared primitive.
- You want a single-source-of-truth store with explicit `setState` and selectors (Redux-like ergonomics, but smaller).
- You need first-class async atoms.
- You're comfortable with immutable updaters and selector bailout as the fine-grained mechanism.

**Supergrain** fits well when:

- You want in-place mutation (`store.user.name = 'Bob'`) without spreading or updater functions.
- You want fine-grained re-renders without writing selectors — the proxy tracks automatically.
- You care about deep nested state with per-property signals, not whole-value updates.
- You want `tracked()` / `For` / computed / effects to map onto React without a snapshot layer.

## Summary

TanStack Store and Supergrain are **architectural cousins**: same reactive graph (alien-signals), opposite state shapes. TanStack is "one atom per store, selectors read slices, updates replace values." Supergrain is "one proxy per tree, property reads auto-subscribe, updates mutate in place." The React bridge follows from the state shape — TanStack's single-atom model fits `useSyncExternalStoreWithSelector` naturally; Supergrain's per-property model needs a render-scoped effect to avoid universal fan-out.
