---
name: supergrain
description: Write React state, derived values, side effects, lists, and writes with Supergrain (@supergrain/kernel, /husk, /mill) instead of useState, useEffect, useMemo, and useCallback. Use this whenever you add, edit, or review React code in a project that depends on @supergrain/* — any time you reach for component state, a shared store, a derived value, an async fetch, a subscription, a timer, an observer, or DOM behavior. Also use it when reviewing a diff that introduces useState or useEffect. For server entities loaded by id and paginated feeds, use the supergrain-silo skill instead.
---

# Supergrain

Do not use `useState` or `useEffect`. They are not the default here and they are not a fallback — every case they cover has a primitive below, so reaching for one means you have not found the right primitive yet.

- `@supergrain/kernel` — `createReactive`, `computed`, `stableComputed`, `effect`, `batch`; `/react` — `tracked`, `useReactive`, `useComputed`, `useSignalEffect`, `createStoreContext`, `For`
- `@supergrain/husk` — `defineResource`, `dispose`; `/react` — `useResource`, `useReactivePromise`, `useReactiveTask`, `modifier`, `useModifier`
- `@supergrain/mill` — `update`, `UpdateOperations`

Server entities fetched by id, and paginated feeds, are a different layer — see the **supergrain-silo** skill.

## Reactivity comes from reading reactive state

Wrap every component in `tracked()`; untracked, its reads subscribe to nothing and the UI goes stale silently.

That one rule governs every re-run below: something re-runs when the **reactive state it read** changes. A prop that **is** a store object stays reactive — `<Row todo={todo} />`, then `todo.done` in a `tracked` child subscribes normally. A plain value copied out — a prop scalar, a `useComputed` result — is dead. To drive work off a scalar prop, mirror it: `const sel = useReactive({ id }); if (sel.id !== id) sel.id = id;`.

## Replace `useState`

`useReactive({ ... })` for component-local. For shared, `createStoreContext<T>()` at module scope → `{ Provider, useStore }`, mounted as `<Provider initial={...}>`. Read and write as plain objects at any depth, synchronously: `store.org.teams[0].active = true`, `store.items.push(x)`.

## Replace `useMemo`, derived state, and lists

`useEffect(() => setX(f(y)), [y])` → `useComputed(() => f(store.y))`, which returns the value, not a wrapper.

`<For each={store.todos}>{(todo) => <Row todo={todo} />}</For>`, not `.map()`. A `parent` ref (O(1) swaps) requires `tracked()` children and your own `key`: `<tbody ref={ref}><For each={rows} parent={ref}>{(r) => <Row key={r.id} row={r} />}</For></tbody>`. A derived array feeding it needs `stableComputed` — a **getter you call**, with no hook, so build it once:

```tsx
const visible = useMemo(() => stableComputed(() => store.tasks.filter((t) => !t.done)), []);
// …later: <For each={visible()}>
```

Drop `useCallback` for handlers that only mutate the store; keep it for closures passed as props to a `tracked` child.

## Replace `useEffect`

Every handle below is reactive: read a field in a `tracked` component and it drives the render.

| The effect                                    | Use                                                                                                          | Read                                                                            | Re-runs when                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Async data                                    | `useReactivePromise(async (signal) => ...)` — `signal` aborts the superseded run                             | `.data` (**`null`** until resolved) `.error` `.isPending` `.isReady` `.promise` | reactive reads **before the first `await`** change     |
| The same, at many call sites (own state each) | `defineResource(() => initial, async (state, args, { abortSignal }) => ...)` + `useResource(fn, () => args)` | **your own state object** — `state.items`; no envelope, no `.data`              | reactive reads in the args thunk change                |
| Subscription, socket, timer                   | `useResource(initial, (state, { onCleanup }) => ...)` — `initial` is a **value**, not a thunk                | same, your own state object                                                     | reactive reads in setup change                         |
| User-triggered work                           | `useReactiveTask(async (...args) => ...)`                                                                    | as `useReactivePromise` but **no `.promise`**; gets no `AbortSignal`            | only `run(...)`, so a prop read in its body is current |
| DOM element behavior                          | `modifier((el, ...args) => cleanupFn)` + `useModifier(m, ...args)` as `ref`                                  | —                                                                               | signals in the body change — args do **not** re-attach |
| Push to an external sink                      | `useSignalEffect(() => ...)`                                                                                 | —                                                                               | reactive reads inside change                           |

Neither has a `refetch` — change what the tracked reads see. On the two envelopes — not on a resource, which has none — `.error` is `unknown`, so narrow it: `{String(task.error)}`, not `{task.error && <p>{task.error}</p>}`.

## Writes

Single writes are always safe. Wrap _multiple_ related writes in `batch(fn)`; sync only, throws on a returned Promise.

For dot-path or operator writes, `update(doc, query, operations)` from `@supergrain/mill` — standard Mongo operators, e.g. `update(card, {}, { $set: { "estimate.points": 5 } })` — pass `{}` as `query` when no positional paths; batches internally, returns `{ doc, undo }`, where `doc` is the same object back and `undo` is an inverse Mongo update document, **not** a function — an `UpdateOperations<T>`, the type to annotate with if you keep an undo stack. Replay it with `update(doc, {}, undo)`.

## Traps

- **Mutating in place is the point** — property assignment (`store.org.teams[0].active = true`), `push`, `splice`, index assignment (`rows[a] = rows[b]`), and `Map`/`Set` writes all notify; `.length`, `.size` and `.has()` are tracked reads. The exception is what supergrain doesn't proxy: `Date`, `RegExp`, class instances. `store.when.setFullYear(2030)` notifies nothing; assign a fresh `Date`.
- Fresh inline objects, arrays, or closures as props re-render a `tracked` child regardless of signals.

## Still React's job

`use(promise.promise)` for Suspense on a `reactivePromise` (a task has none), `useRef` for a raw DOM node, `useId` / `useTransition` / `useDeferredValue`, and `useMemo` to build a `computed` / `stableComputed` once or for expensive pure computation with no reactive reads.


Every behavioural claim above is pinned by `packages/*/tests/skill-claims/*.test.tsx`.
