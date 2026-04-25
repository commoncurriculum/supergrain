# @supergrain/husk

Reactive side-effect primitives for Supergrain — the layer between `@supergrain/kernel`'s raw reactivity and application-specific data layers like `@supergrain/silo`.

- **`resource`** — inline reactive function with cleanup logic.
- **`defineResource`** — reusable resource factory; args thunks make reruns explicit at the call site.
- **`reactivePromise`** — async envelope (`data`, `error`, `isPending`, …) with abort on rerun.
- **`reactiveTask`** — imperative async command (`.run(...)`).
- **`behavior`** — element-scoped setup/teardown; signals inside setup drive targeted re-attach without re-rendering.

## Install

```bash
pnpm add @supergrain/kernel @supergrain/husk
```

React bindings ship at `@supergrain/husk/react` and require `react >= 18.2`.

## Quick pick

| Need                                                             | Reach for                                |
| ---------------------------------------------------------------- | ---------------------------------------- |
| Async fetch with tracked inputs — want the standard envelope     | `reactivePromise` / `useReactivePromise` |
| Reusable primitive called many places, args visible at call site | `defineResource` + `useResource`         |
| One-off side effect with a custom state shape                    | `resource` / `useResource`               |
| User-triggered work (save, submit) — no auto-run                 | `reactiveTask` / `useReactiveTask`       |
| Behavior attached to a specific DOM element                      | `behavior` / `useBehavior`               |

## `reactivePromise(asyncFn)`

In React, `useReactivePromise(asyncFn)` is component-scoped (auto-disposed on unmount):

```tsx
import { tracked, useGrain } from "@supergrain/kernel/react";
import { useReactivePromise } from "@supergrain/husk/react";

const Profile = tracked(() => {
  const state = useGrain({ userId: 1 });
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

Outside React, `reactivePromise(asyncFn)` returns the same envelope; pair with module-scope `createGrain`:

```ts
import { createGrain } from "@supergrain/kernel";
import { reactivePromise } from "@supergrain/husk";

const state = createGrain({ userId: 1 });
const user = reactivePromise(async (signal) => {
  const res = await fetch(`/users/${state.userId}`, { signal });
  return res.json() as Promise<User>;
});

user.data; // User | null
user.isPending; // boolean
user.isReady; // sticky — true once first resolve lands
await user.promise; // works with React 19 `use()` for Suspense

state.userId = 2; // old fetch aborts, new one starts
```

## `defineResource(initial, setup)` + `useResource(factory, argsFn?)`

Define a primitive once, use it many places. The thunk passed at the call site is the reactive boundary — reading it, you see what triggers reruns.

```ts
import { defineResource } from "@supergrain/husk";

export const subscribeChannel = defineResource<string, { messages: Message[] }>(
  () => ({ messages: [] }),
  (state, channelId, { onCleanup }) => {
    const sock = new WebSocket(`wss://chat/${channelId}`);
    sock.addEventListener("message", (e) => state.messages.push(JSON.parse(e.data)));
    onCleanup(() => sock.close());
  },
);
```

In React:

```tsx
import { tracked, useGrain } from "@supergrain/kernel/react";
import { useResource } from "@supergrain/husk/react";

const ChannelView = tracked(() => {
  const state = useGrain({ name: "general" });
  const chat = useResource(subscribeChannel, () => state.name);
  return (
    <>
      <button onClick={() => (state.name = "random")}>Switch</button>
      <MessageList messages={chat.messages} />
    </>
  );
});
```

Outside React:

```ts
import { createGrain } from "@supergrain/kernel";

const state = createGrain({ name: "general" });
const chat = subscribeChannel(() => state.name);
state.name = "random"; // old socket closes, new one opens
```

Reads inside `setup` are NOT tracked in the factory form — only the thunk drives reruns. "What triggers a rerun" lives at the call site, not buried in setup.

## `resource(initial, setup)` + `useResource(initial, setup)`

Inline, one-off. Reactive reads in `setup` drive reruns. No deps array — the reactive reads inside `setup` ARE the dep list.

In React:

```tsx
import { tracked, useGrain } from "@supergrain/kernel/react";
import { useResource } from "@supergrain/husk/react";

const Crosshair = tracked(() => {
  const opts = useGrain({ enabled: true });
  const cursor = useResource({ x: 0, y: 0 }, (state, { onCleanup }) => {
    if (!opts.enabled) return; // reactive read — toggle re-runs setup
    const h = (e: MouseEvent) => {
      state.x = e.clientX;
      state.y = e.clientY;
    };
    window.addEventListener("mousemove", h);
    onCleanup(() => window.removeEventListener("mousemove", h));
  });
  return (
    <>
      <button onClick={() => (opts.enabled = !opts.enabled)}>Toggle</button>
      <div>
        ({cursor.x}, {cursor.y})
      </div>
    </>
  );
});
```

Outside React:

```ts
import { createGrain } from "@supergrain/kernel";
import { resource } from "@supergrain/husk";

const opts = createGrain({ enabled: true });
const cursor = resource({ x: 0, y: 0 }, (state, { onCleanup }) => {
  if (!opts.enabled) return;
  const h = (e: MouseEvent) => {
    state.x = e.clientX;
    state.y = e.clientY;
  };
  window.addEventListener("mousemove", h);
  onCleanup(() => window.removeEventListener("mousemove", h));
});
opts.enabled = false; // listener detaches
```

## `reactiveTask(asyncFn)` + `useReactiveTask(asyncFn)`

Imperative. No auto-tracking. Same envelope shape as `reactivePromise`, plus `.run(...args)`.

In React:

```tsx
import { tracked } from "@supergrain/kernel/react";
import { useReactiveTask } from "@supergrain/husk/react";

const SaveButton = tracked(({ draft }: { draft: Draft }) => {
  const save = useReactiveTask(async (d: Draft) => {
    const res = await fetch("/drafts", { method: "POST", body: JSON.stringify(d) });
    return res.json() as Promise<Draft>;
  });
  return (
    <button onClick={() => save.run(draft)} disabled={save.isPending}>
      {save.isPending ? "Saving…" : save.error ? "Retry" : "Save"}
    </button>
  );
});
```

Task identity is stable across renders (safe to pass to children); the `asyncFn` closure refreshes per render via a ref so closed-over values stay current.

Outside React:

```ts
import { reactiveTask } from "@supergrain/husk";

const saveDraft = reactiveTask(async (d: Draft) => {
  const res = await fetch("/drafts", { method: "POST", body: JSON.stringify(d) });
  return res.json() as Promise<Draft>;
});

await saveDraft.run(myDraft);
saveDraft.data; // Draft | null
```

## `behavior(fn)` + `useBehavior(m, ...args)`

Element-scoped setup/teardown attached via `ref`. What it buys you that plain `useEffect` can't:

1. **Element-scoped lifecycle**: the setup runs when React attaches the ref, cleanup fires on detach. No `ref.current` timing gymnastics.
2. **Fresh args without re-register**: args flow through an internal ref — the listener attaches once on mount, but every invocation uses the latest closure.
3. **Signal reads inside `behavior` re-run setup WITHOUT re-rendering the component.** This is the one `useEffect` genuinely can't compose — `useEffect` doesn't subscribe to signals, and `useSignalEffect` doesn't give you the element.
4. **Reusable across elements and components.** Define once at module scope, apply anywhere.

```tsx
import { createGrain } from "@supergrain/kernel";
import { behavior, useBehavior } from "@supergrain/husk/react";

export const observerSettings = createGrain<{ box: "border-box" | "content-box" }>({
  box: "content-box",
});

// Point 3: reactive read inside setup, no component re-render on change
const trackSize = behavior<HTMLElement, [(size: DOMRect) => void]>((el, onResize) => {
  const observer = new ResizeObserver(([entry]) => onResize(entry!.contentRect));
  observer.observe(el, { box: observerSettings.box }); // tracked
  return () => observer.disconnect();
});

function Panel({ onResize }: { onResize: (r: DOMRect) => void }) {
  return <div ref={useBehavior(trackSize, onResize)}>…</div>;
}
```

Set `observerSettings.box = "border-box"` from anywhere — the behavior tears down the old observer and attaches a new one with the fresh box option. `Panel` does NOT re-render; only the observer is replaced.

## `dispose(resource)`

Free function that stops a resource permanently: aborts in-flight work, runs cleanups, halts the effect. Idempotent, safe on any object. In React, `useResource` / `useReactivePromise` dispose automatically on unmount.

```ts
import { reactivePromise, dispose } from "@supergrain/husk";

const user = reactivePromise(async (signal) => fetch(url, { signal }).then((r) => r.json()));
// later…
dispose(user);
```

## Lives outside the component tree

Resources aren't hooks. Define at module scope; read from event handlers, tests, workers — anywhere. Rules of Hooks doesn't apply.

```ts
import { createGrain } from "@supergrain/kernel";
import { reactivePromise } from "@supergrain/husk";

const state = createGrain({ userId: 1 });
const user = reactivePromise(async (signal) =>
  fetch(`/users/${state.userId}`, { signal }).then((r) => r.json()),
);

// Read from anywhere — non-React code, tests, event handlers:
console.log(user.data);
state.userId = 2; // reruns from anywhere
```

## What all four primitives package up

Six concerns every hand-rolled "reactive async value" has to get right:

1. `AbortController` lifecycle tied to effect reruns — fresh per run, aborted on rerun or dispose.
2. Generation counter — stale async responses don't clobber state when inputs change mid-fetch.
3. Ordered cleanup before re-setup — old run's teardown runs _before_ the new setup starts.
4. `onCleanup` registration — cleanups registered inside async setups still fire.
5. Idempotent dispose — safe to call twice, safe during an in-flight rerun.
6. Sync and async setup shapes — sync returns cleanup (`return () => …`); async uses `onCleanup` (return resolves a Promise, not a function).

## License

MIT
