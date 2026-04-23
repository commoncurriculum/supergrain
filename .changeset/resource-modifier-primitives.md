---
"@supergrain/kernel": minor
---

Add `resource` / `useResource` and `modifier` / `useModifier` primitives, and rebuild `reactivePromise` as ergonomic sugar on top of `resource`.

**`resource(initial, setup)`** — a reactive value produced by a setup function with cleanup. Setup runs on create, reruns on tracked signal change (cleanup first), and exposes an `AbortSignal` that aborts on rerun/dispose. Covers the cases where you'd otherwise hand-roll a `useState` + `useEffect` + `useRef` triple: timers, observers, subscriptions, media queries, geolocation watches, non-entity async fetches. Unlike a custom hook, a resource isn't bound to React — define it at module scope, consume it from event handlers, tests, or workers, and let it react to module-scope signals.

```ts
const userId = signal(1);
const user = resource<User | null>(null, async ({ set, signal }) => {
  const id = userId(); // tracked — reruns on change, previous aborted
  const res = await fetch(`/users/${id}`, { signal });
  set(await res.json());
});
```

**`modifier(fn)` + `useModifier(m, ...args)`** — reusable setup/teardown attached to a DOM element via `ref`. Fixes the stale-handler-vs-reregister-every-render dilemma (args flow through an internal ref, the listener attaches once), and lets element-scoped behavior react to supergrain signals without re-rendering the surrounding component.

```ts
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

**`reactivePromise` is now sugar over `resource`.** Same public API, same behavior — internally it delegates its effect/rerun/abort lifecycle to `resource` and adds the async envelope (`isPending`, `isResolved`, `isRejected`, thenable) on top. One primitive, two ergonomic surfaces.
