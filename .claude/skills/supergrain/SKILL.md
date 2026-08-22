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
- `@supergrain/silo/react` — `createDocumentStoreContext` **only**; it returns `Provider` / `useDocumentStore` / `useDocument` / `useQuery`

## Reactivity comes from reading reactive state

Wrap every component in `tracked()`; untracked, its reads subscribe to nothing and the UI goes stale silently.

The same rule governs every re-run below: something re-runs when the **reactive state it read** changes. Props, plain variables, and a value already pulled out of a `useComputed` are not reactive state. To drive work off a prop, put it in reactive state first — `const sel = useReactive({ id }); if (sel.id !== id) sel.id = id;` — or key it through silo, whose `useDocument("book", id)` re-reads on each render.

## Replace `useState`

| State                         | Use                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component-local               | `useReactive({ ... })`                                                                                                                                                                                                                                                                                        |
| Shared                        | `createStoreContext<T>()` at module scope → `{ Provider, useStore }`; mount `<Provider initial={...}>`                                                                                                                                                                                                        |
| Server entity by id or params | `createDocumentStoreContext<DocumentStore<Models, Queries>>()` → `{ Provider, useDocument, useQuery }`; mount `<Provider config={{ models: { book: { adapter } }, queries }}>`                                                                                                                                |
| Paginated or live feed        | `createQuery({ store, adapter, type, id })` from `@supergrain/queries` — plain function, not a hook; `store` comes from `useDocumentStore()` and is typed `DocumentStore<Models>`; each result row carries an `offset`. Exposes `.results` / `.nextOffset` / `.fetchNextPage()` / `.refetch()` / `.destroy()` |

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

| The effect                           | Use                                                                                                          | Re-runs when                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Async data                           | `useReactivePromise(async (signal) => ...)`                                                                  | reactive reads **before the first `await`** change     |
| Async data, reused across call sites | `defineResource(() => initial, async (state, args, { abortSignal }) => ...)` + `useResource(fn, () => args)` | reactive reads inside the args thunk change            |
| Subscription, socket, timer          | `useResource(initial, (state, { onCleanup }) => ...)` — same hook, other overload                            | reactive reads in setup change                         |
| DOM element behavior                 | `modifier((el, ...args) => cleanupFn)` + `useModifier(m, ...args)` as `ref`                                  | signals in the body change — args do **not** re-attach |
| User-triggered work (save, submit)   | `useReactiveTask(async (...args) => ...)` + `task.run(...)`                                                  | only `run()`                                           |
| Push to an external sink             | `useSignalEffect(() => ...)`                                                                                 | reactive reads inside change                           |
| Domain entity                        | `useDocument` / `useQuery`                                                                                   | id or params change                                    |

`useReactiveTask` takes your own args and receives no `AbortSignal`. Its envelope is reactive — reading `task.isPending` in a `tracked` component drives the spinner. Because it runs on demand rather than from reads, a prop read in its body is always current.

## Lists

`<For each={store.todos}>{(todo) => <Row todo={todo} />}</For>`, not `.map()`. A `parent` ref (O(1) swaps) requires `tracked()` children and your own `key`.

## Writes

Single writes are always safe. Wrap _multiple_ related writes in `batch(fn)`; sync only, throws on a returned Promise.

For dot-path or operator writes, `update(doc, query, operations)` from `@supergrain/mill` — pass `{}` as `query` when no positional paths; batches internally, returns `{ doc, undo }`, where `doc` is the same object back and `undo` is an inverse Mongo update document — not a function. Replay it with `update(doc, {}, undo)`.

## Traps

- Neither husk nor silo has `refetch` (a `createQuery` handle does). A `reactivePromise` / `reactiveTask` envelope exposes `.data` / `.error` / `.isPending` / `.isReady`, plus `.promise` on a promise but **not** on a task. A **resource has no envelope**: `useResource` hands back your own state object, so read `state.items`, never `.data`. silo handles expose `.value` / `.error` / `.isFetching` / `.status` / `.promise`, discriminated on `.status` — `.value` is `undefined` until it resolves. Re-fetch by changing what the tracked reads see — the args thunk for husk, the id or params for silo; a document whose id never changes has no refresh lever, so write the new one with `store.insertDocument(type, doc)`.
- husk's `.error` is `unknown`, so it needs narrowing before render — `{String(task.error)}`, not `{task.error && <p>{task.error}</p>}`. silo's is a `SiloError`.
- **Mutating in place is the point** — `store.org.teams[0].active = true`, `store.items.push(x)`, `store.m.set(k, v)` all notify. The one exception is values supergrain doesn't proxy: `Date`, `RegExp`, and class instances. `store.when.setFullYear(2030)` notifies nothing; assign a fresh `Date` instead.
- Fresh inline objects, arrays, or closures as props re-render a `tracked` child regardless of signals.

## Still React's job

`use(handle.promise!)` for Suspense (a `reactivePromise` or silo handle — a task has none; a silo handle's is `undefined` until a fetch is in flight, hence the `!`), `useRef` for a raw DOM node, `useId` / `useTransition` / `useDeferredValue`, and `useMemo` to build a `computed` / `stableComputed` once or for expensive pure computation with no reactive reads.

Every behavioural claim above is pinned by `packages/*/tests/skill-claims/*.test.tsx`.
