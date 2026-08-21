---
name: supergrain
description: Write React state, derived values, and side effects with Supergrain (@supergrain/kernel, /husk, /silo, /mill, /queries) instead of useState, useEffect, useMemo, and useCallback. Use this whenever you add, edit, or review React code in a project that depends on @supergrain/* — any time you reach for component state, a shared store, a derived value, data fetching, a subscription, a timer, an observer, or DOM behavior. Also use it when reviewing a diff that introduces useState or useEffect.
---

# Supergrain

`useState` and `useEffect` are the fallback here, not the default. Import from:

- `@supergrain/kernel` — `createReactive`, `computed`, `stableComputed`, `effect`, `batch`
- `@supergrain/kernel/react` — `tracked`, `useReactive`, `useComputed`, `useSignalEffect`, `createStoreContext`, `For`
- `@supergrain/husk` — `resource`, `defineResource`, `reactivePromise`, `reactiveTask`, `dispose`
- `@supergrain/husk/react` — `useResource`, `useReactivePromise`, `useReactiveTask`, `modifier`, `useModifier`
- `@supergrain/silo/react` — `createDocumentStoreContext` **only**; it returns `useDocument` / `useQuery`

## Wrap every component in `tracked()`

Untracked reads subscribe to nothing: the UI goes stale, silently.

## Replace `useState`

| State                         | Use                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component-local               | `useReactive({ ... })`                                                                                                                                  |
| Shared                        | `createStoreContext<T>()` at module scope → `{ Provider, useStore }`; mount `<Provider initial={...}>`                                                  |
| Server entity by id or params | `createDocumentStoreContext<DocumentStore<Models, Queries>>()` → `{ Provider, useDocument, useQuery }`; mount `<Provider config={{ models, queries }}>` |
| Paginated or live feed        | `createQuery({ store, adapter, type, id })` from `@supergrain/queries` — plain function, not a hook; needs a silo store                                 |

Read and write as plain objects at any depth, synchronously: `store.org.teams[0].active = true`, `store.items.push(x)`.

## Replace `useMemo` and derived state

`useEffect(() => setX(f(y)), [y])` → `useComputed(() => f(store.y))`, which returns the value, not a wrapper.

A derived array feeding `<For>` needs `stableComputed`, which returns a **getter you call**, and has no hook — build it once and call it:

```tsx
const visible = useMemo(() => stableComputed(() => store.tasks.filter((t) => !t.done)), []);
// …later: <For each={visible()}>
```

Drop `useCallback` for handlers that only mutate the store; keep it for closures passed as props to a `tracked` child.

## Replace `useEffect`

| The effect                           | Use                                                                                                          | Re-runs when                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Async data                           | `useReactivePromise(async (signal) => ...)`                                                                  | reads **before the first `await`** change                           |
| Async data, reused across call sites | `defineResource(() => initial, async (state, args, { abortSignal }) => ...)` + `useResource(fn, () => args)` | reads **inside** the args thunk change (a prop there is not a read) |
| Subscription, socket, timer          | `useResource(initial, (state, { onCleanup }) => ...)`                                                        | reads in setup change                                               |
| DOM element behavior                 | `modifier((el, ...args) => cleanupFn)` + `useModifier(m, ...args)` as `ref`                                  | signals in the body change — args do **not** re-attach              |
| User-triggered work (save, submit)   | `useReactiveTask(async (...args) => ...)` + `task.run(...)`                                                  | only `run()`                                                        |
| Push to an external sink             | `useSignalEffect(() => ...)`                                                                                 | reads inside change                                                 |
| Domain entity                        | `useDocument` / `useQuery`                                                                                   | id or params change                                                 |

`useReactiveTask` takes your own args and receives no `AbortSignal`. Its envelope is still reactive — reading `task.isPending` in a `tracked` component drives the spinner.

## Lists

`<For each={store.todos}>{(todo) => <Row todo={todo} />}</For>`, not `.map()`. A `parent` ref (O(1) swaps) requires `tracked()` children and your own `key`.

## Writes

Single writes are always safe. Wrap _multiple_ related writes in `batch(fn)`; sync only, throws on a returned Promise.

For dot-path or operator writes, `update(doc, query, operations)` from `@supergrain/mill` — pass `{}` as `query` when no positional paths; batches internally, returns `{ doc, undo }`.

## Traps

- Neither layer has `refetch`. husk exposes `.data` / `.error` / `.isPending` / `.isReady`, plus `.promise` on a `reactivePromise` but **not** on a task; silo handles expose `.value` / `.error` / `.isFetching` / `.status` / `.promise`. Re-fetch by changing the id or params silo is keyed on.
- **Mutating in place is the point** — `store.org.teams[0].active = true`, `store.items.push(x)`, `store.m.set(k, v)` all notify. The one exception is values supergrain doesn't proxy: `Date`, `RegExp`, and class instances. `store.when.setFullYear(2030)` notifies nothing; assign a fresh `Date` instead.
- Keying a fetch off a **prop**: neither `useReactivePromise` nor `useResource`'s args thunk re-runs — a prop is not a signal, and the thunk is not an escape hatch. Mirror it (`const sel = useReactive({ id }); if (sel.id !== id) sel.id = id;`) and read `sel.id` before the first `await`, or use silo. `useReactiveTask` is unaffected.
- A `useSignalEffect` that closes over a `useComputed` **value** never re-runs — `useComputed` hands back a plain number, so the effect body has no signal to subscribe to. Read the store inside the effect.
- Fresh inline objects, arrays, or closures as props re-render a `tracked` child regardless of signals.

## Still React's job

`use(handle.promise)` for Suspense (a `reactivePromise` or silo handle — a task has none), `useRef` for a raw DOM node, `useId` / `useTransition` / `useDeferredValue`, and `useMemo` to build a `computed` / `stableComputed` once or for expensive pure computation with no reactive reads.

Every behavioural claim above is pinned by `packages/*/tests/skill-claims/*.test.tsx`.
