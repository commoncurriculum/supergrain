---
name: supergrain
description: Write React state, derived values, and side effects with Supergrain (@supergrain/kernel, /husk, /silo, /mill, /queries) instead of useState, useEffect, useMemo, and useCallback. Use this whenever you add, edit, or review React code in a project that depends on @supergrain/* — any time you reach for component state, a shared store, a derived value, data fetching, a subscription, a timer, an observer, or DOM behavior. Also use it when reviewing a diff that introduces useState or useEffect, since those are almost always the wrong default here.
---

# Supergrain

In a Supergrain project, `useState` and `useEffect` are not the default — they are the fallback for the short list at the bottom of this file. Reaching for them usually means re-implementing, by hand and worse, something a Supergrain primitive already owns.

Every component that reads reactive state must be wrapped in `tracked()`. Without it you still get correct values, but you lose the per-property re-render scoping that is the whole point of the library.

## State: replace `useState`

| Situation | Use |
| --- | --- |
| State scoped to one component | `useReactive({ ... })` from `@supergrain/kernel/react` |
| State shared across components | `createStoreContext<T>()` at module scope; mount `<Provider initial={...}>` once |
| A server entity keyed by id or params | `useDocument("user", id)` / `useQuery("posts", params)` from `@supergrain/silo/react` |
| A paginated or live-subscribed feed | `createQuery` from `@supergrain/queries` |

Read and write reactive state as plain objects — `state.count++`, `store.org.teams[0].active = true`, `store.items.push(x)`. Deep mutation is tracked at any depth. Writes are synchronous, so you can read your own write on the next line. No spreading, no setters, no updater functions, no immer.

```tsx
import { tracked, useReactive } from "@supergrain/kernel/react";

const Counter = tracked(() => {
  const state = useReactive({ count: 0 });
  return <button onClick={() => state.count++}>{state.count}</button>;
});
```

## Derived values: replace `useMemo`

Use `useComputed(() => ...)` for anything derived from reactive state. It re-evaluates when upstream signals change but only re-renders when the **result** changes, so 998 rows returning `false` stay put while the 2 that flip update.

Never derive state into state with an effect. `useEffect(() => setX(f(y)), [y])` is `useComputed(() => f(store.y))`.

Handlers that just mutate the store need no `useCallback` — there is no dependency array to keep in sync. Keep `useCallback` only when the closure is passed as a prop into a `tracked` child, whose `React.memo` wrapper compares props by reference.

## Side effects: replace `useEffect`

Pick by what the effect is actually doing. All of these are in `@supergrain/husk/react` except `useSignalEffect`, which is in `@supergrain/kernel/react`.

| What the effect does | Use |
| --- | --- |
| Fetch async data from tracked inputs | `useReactivePromise(async (signal) => ...)` — gives `data`, `error`, `isPending`, `promise`, and aborts the previous run |
| Same, but reusable across call sites | `defineResource(...)` once, then `useResource(fn, () => args)` |
| Subscribe / open a socket / start a timer / attach a listener | `useResource(initial, (state, { onCleanup }) => ...)` |
| Attach behavior to a DOM element (observers, focus traps, click-outside) | `useModifier(myModifier, ...args)` on the element's `ref` |
| User-triggered async work (save, submit, delete) | `useReactiveTask(async (...) => ...)` then `task.run(...)` |
| Push a reactive value somewhere external (`document.title`, localStorage, analytics) | `useSignalEffect(() => ...)` |
| Fetch a domain entity from your API | Not an effect at all — `useDocument` / `useQuery` |

These are not sugar. They package the six things a hand-rolled effect gets wrong: `AbortController` lifecycle, a generation counter so a stale response can't clobber fresh state, cleanup ordered before re-setup, `onCleanup` inside async setups, idempotent dispose, and the sync-vs-async cleanup shape. `useModifier` also does something `useEffect` structurally cannot: a signal read inside its setup re-attaches the behavior on the element **without re-rendering the component**.

Effects re-run from the reactive reads inside them. There is no dependency array anywhere in this list.

```tsx
const Profile = tracked(() => {
  const state = useReactive({ userId: 1 });
  const user = useReactivePromise(async (signal) => {
    const res = await fetch(`/users/${state.userId}`, { signal });
    return res.json() as Promise<User>;
  });
  return (
    <>
      <button onClick={() => state.userId++}>Next</button>
      {user.data && <UserCard user={user.data} />}
    </>
  );
});
```

## Lists

Render arrays with `<For each={store.todos}>{(todo) => <Row todo={todo} />}</For>`, not `.map()`. `For` tracks per-item so only changed rows re-render. Pass a `parent` ref to get O(1) DOM moves on swaps.

## Batched and deep writes

Single mutations are always safe. Wrap **multiple related writes** in `batch(fn)` from `@supergrain/kernel` so effects observe only the final state — without it, a computed reading two swapped slots sees the torn intermediate. `batch` is sync-only and throws on a returned Promise.

For dot-path or operator-style writes (`$set`, `$inc`, `$push`, `$pull`, `$unset`), use `update` from `@supergrain/mill`. Plain assignment is still the usual path.

## Traps

- **Forgetting `tracked()`** — the code works but every render is coarse. This is the single most common mistake.
- **Non-plain values are not reactive.** Plain objects, arrays, `Map`, and `Set` are proxied. Class instances, `Date`, `RegExp`, and functions pass through unchanged — mutating them fires nothing. Keep them out of the store.
- **Fresh inline props still defeat memo.** `tracked()` wraps in `React.memo`; a new object, array, or closure literal in props re-renders the child anyway.
- **No `await` inside `batch()`.**
- **Subtree-wide subscription doesn't exist.** Subscriptions are per-property. To react to `a.b.c`, something must read `a.b.c` (or a computed over it) inside the effect.

## When React's own hooks are still correct

- `use(handle.promise)` for Suspense on a silo document or a husk promise.
- `useRef` for a raw DOM node a third-party library demands — though `modifier` is usually the better fit.
- `useId`, `useTransition`, `useDeferredValue`, and other scheduling hooks.
- Wrapping a third-party hook that owns its own state.
- `useMemo` for expensive pure computation over props with no reactive reads.

Everything else belongs to a Supergrain primitive.
