---
"@supergrain/kernel": minor
---

Add `resource` / `useResource` and `modifier` / `useModifier` primitives, and rebuild `reactivePromise` / `reactiveTask` on the new shape.

## `resource(initial, setup)` — a reactive function with cleanup logic

The state object you pass as the first argument becomes a reactive proxy (via `createReactive`). Setup mutates fields directly — same mutation-first idiom as everywhere else in the library. Setup runs on create, re-runs whenever any reactive value it read changes (cleanup first), and runs final cleanup on `dispose(resource)`.

```ts
import { resource, signal } from "@supergrain/kernel";

const userId = signal(1);
const user = resource(
  { data: null as User | null, error: null as Error | null, isLoading: false },
  async (state, { abortSignal }) => {
    state.isLoading = true;
    state.error = null;
    try {
      const res = await fetch(`/users/${userId()}`, { signal: abortSignal });
      state.data = await res.json();
    } catch (e) {
      state.error = e as Error;
    } finally {
      state.isLoading = false;
    }
  },
);

user.data; // reactive field, flat access
user.isLoading;
```

Packages up six correctness concerns that every hand-rolled "reactive async value" solution has to get right: `AbortController` lifecycle, generation counter for stale-response discard, ordered cleanup before re-setup, onCleanup registration, idempotent dispose, and unified sync/async setup handling.

Unlike a custom hook, a resource isn't bound to React — define at module scope, consume from event handlers / tests / workers, drive with module-scope signals.

## `dispose(resource)` — free function

Stops a resource permanently: aborts in-flight work, runs cleanups, halts the reactive effect. Idempotent. In React, `useResource` disposes automatically on unmount — you rarely call this directly.

## `modifier(fn)` + `useModifier(m, ...args)` — element-scoped setup/teardown

Reusable DOM-element setup/teardown attached via `ref`. Fixes the stale-handler-vs-reregister-every-render dilemma (args flow through an internal ref, the listener attaches once), and lets element-scoped behavior react to supergrain signals without re-rendering the surrounding component.

```tsx
const onClickOutside = modifier<HTMLElement, [() => void]>((el, onOutside) => {
  const handler = (e: MouseEvent) => {
    if (!el.contains(e.target as Node)) onOutside();
  };
  document.addEventListener("click", handler);
  return () => document.removeEventListener("click", handler);
});

function Popover({ onClose }) {
  return <div ref={useModifier(onClickOutside, onClose)}>…</div>;
}
```

## `reactivePromise` / `reactiveTask` — rebuilt on `resource`

Both now delegate their lifecycle to `resource` and expose their envelope as a flat reactive object.

Envelope field names changed to match the ecosystem (SWR, TanStack Query, Apollo, URQL) and `@supergrain/silo` exactly:

- `value` → **`data`** (the resolved value)
- Added **`promise: Promise<T>`** (matches silo's `handle.promise`; use for `await` or React 19 `use()`)
- Dropped thenable on the envelope itself — use `.promise` explicitly

```ts
const rp = reactivePromise(async (abortSignal) => {
  const res = await fetch(url, { signal: abortSignal });
  return res.json();
});

rp.data; // T | null
rp.error; // unknown
rp.isPending; // boolean
rp.isResolved; // boolean
rp.isRejected; // boolean
rp.isSettled; // boolean
rp.isReady; // boolean (sticky — true once first resolve lands)
rp.promise; // Promise<T>

await rp.promise; // explicit
use(rp.promise); // React 19 Suspense

// Dispose is a free function:
import { dispose } from "@supergrain/kernel";
dispose(rp);
```

`reactiveTask` has the same envelope plus a `run(...args)` method:

```ts
const saveUser = reactiveTask(async (id: string, name: string) => {
  const res = await fetch(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return res.json();
});

<button onClick={() => saveUser.run(id, name)} disabled={saveUser.isPending}>
  Save
</button>
```

## React hooks

- `useResource(initial, setup, deps?)` — component-scoped resource, auto-disposed on unmount
- `useReactivePromise(asyncFn, deps?)` — component-scoped reactivePromise
- `useReactiveTask(asyncFn, deps?)` — component-scoped reactiveTask
- `useModifier(m, ...args)` — stable ref callback for applying a modifier to an element
