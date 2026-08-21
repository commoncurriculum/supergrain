---
name: supergrain
description: Write React state, derived values, and side effects with Supergrain (@supergrain/kernel, /husk, /silo, /mill, /queries) instead of useState, useEffect, useMemo, and useCallback. Use this whenever you add, edit, or review React code in a project that depends on @supergrain/* — any time you reach for component state, a shared store, a derived value, data fetching, a subscription, a timer, an observer, or DOM behavior. Also use it when reviewing a diff that introduces useState or useEffect.
---

# Supergrain

`useState` and `useEffect` are the fallback here, not the default. Import from:

- `@supergrain/kernel` — `createReactive`, `computed`, `stableComputed`, `effect`, `batch`
- `@supergrain/kernel/react` — `tracked`, `useReactive`, `useComputed`, `useSignalEffect`, `createStoreContext`, `For`
- `@supergrain/husk/react` — `useResource`, `useReactivePromise`, `useReactiveTask`, `modifier`, `useModifier`
- `@supergrain/silo/react` — `createDocumentStoreContext` **only**; `useDocument` / `useQuery` are returned by it, not exported

## Wrap every component in `tracked()`

Outside a tracked scope a proxy read creates no signal and subscribes to nothing. The component renders the right value once and then never updates. This fails silently — no warning, no error, just stale UI.

## Replace `useState`

| State | Use |
| --- | --- |
| Local to one component | `useReactive({ ... })` |
| Shared across components | `createStoreContext<T>()` at module scope → `{ Provider, useStore }`; mount `<Provider initial={...}>`; read via `useStore()` |
| Server entity by id or params | `createDocumentStoreContext<DocumentStore<Models, Queries>>()` → `{ Provider, useDocument, useQuery }`; mount `<Provider config={{ models, queries }}>` |
| Paginated or live feed | `createQuery({ store, adapter, type, id })` from `@supergrain/queries` — a plain function, not a hook; needs a configured silo store |

Read and write as plain objects: `state.count++`, `store.org.teams[0].active = true`, `store.items.push(x)`. Tracked at any depth; writes are synchronous.

```tsx
const Counter = tracked(() => {
  const state = useReactive({ count: 0 });
  return <button onClick={() => state.count++}>{state.count}</button>;
});
```

## Replace `useMemo` and derived state

`useEffect(() => setX(f(y)), [y])` → `useComputed(() => f(store.y))`. Never derive state into state with an effect.

`useComputed` returns the value, not a wrapper, and only re-renders when the **result** changes. Feeding a derived array to `<For>` is the exception: use `stableComputed(() => xs.filter(...))`, which reconciles one persistent array in place. A plain `useComputed` returns a fresh array each run and defeats `For`'s per-item tracking.

Handlers that only mutate the store need no `useCallback` — there is no dependency array. Keep it when the closure is a prop to a `tracked` child, since `tracked()` wraps in `React.memo`.

## Replace `useEffect`

| The effect | Use | Re-runs when |
| --- | --- | --- |
| Fetches async data | `useReactivePromise(async (signal) => ...)` | reads **before the first `await`** change |
| Same, reused across call sites | `defineResource(...)` + `useResource(fn, () => args)` | the args thunk changes |
| Subscribes, opens a socket, starts a timer | `useResource(initial, (state, { onCleanup }) => ...)` | reads inside setup change |
| Attaches behavior to a DOM element | `useModifier(m, ...args)` as the element's `ref` | signals read in the modifier body change — args do **not** re-attach |
| Runs user-triggered work (save, submit) | `useReactiveTask(async (...args) => ...)` + `task.run(...)` | never — only `run()` |
| Pushes a value to an external sink | `useSignalEffect(() => ...)` | reads inside change |
| Fetches a domain entity | `useDocument` / `useQuery` | the id or params change |

`useReactivePromise` gets an `AbortSignal` and aborts the prior run; `useReactiveTask` takes your own args and gets no signal.

## Lists

Use `<For each={store.todos}>{(todo) => <Row todo={todo} />}</For>`, not `.map()`. Passing a `parent` ref enables O(1) DOM moves on swaps, but then children **must** be `tracked()` components and **you** must pass `key` — `For` only supplies one on the non-`parent` path.

## Writes

Wrap multiple related writes in `batch(fn)` so effects see only the final state. Sync only — it throws on a returned Promise.

For dot-path or operator writes, `update(doc, query, operations)` from `@supergrain/mill` takes three arguments; pass `{}` as `query` when no positional paths are involved. It already batches internally and returns `{ doc, undo }`.

## Traps

- **Envelope fields differ.** husk exposes `.data` / `.isPending`; silo handles expose `.value` / `.isFetching` / `.status` / `.promise` and have no `refetch`.
- **Non-plain values.** Plain objects, arrays, `Map`, `Set` are proxied. `Date`, `RegExp`, and class instances are not — assign a replacement wholesale; never mutate one in place.
- **Fresh inline objects, arrays, or closures as props** re-render a `tracked` child regardless of signals.

## Still React's job

`use(handle.promise)` for Suspense, `useRef` for a DOM node a library demands, `useId` / `useTransition` / `useDeferredValue`, and `useMemo` for expensive pure computation with no reactive reads.
