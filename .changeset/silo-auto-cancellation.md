---
"@supergrain/silo": minor
---

Fetch cancellation is now automatic and signals-native — it rides the reactive graph instead of manual ref-counting.

Every handle carries a dedicated reactive liveness node; reading a handle through `find` / `findQuery` subscribes the rendering component to it (via the kernel's new `onObservationChange` primitive). When the **last** component observing a handle unmounts, its in-flight fetch is interrupted — aborting the request's `AbortSignal` — after the `gcTimeMs` grace window, and the handle resets to idle so renewed interest refetches. A batch is only cancelled when the last observer for **every** key in it goes away.

`useDocument` / `useQuery` remain **pure reactive reads** — no `useEffect`, no imperative subscription — and now drive cancellation automatically on unmount. The transient unobserve/re-observe of a `tracked()` re-render never cancels: the kernel coalesces and re-checks observation on a microtask, and `gcTimeMs` (default `0` = next tick) plus an `isObserved` re-check at sweep time absorb a StrictMode remount or fast nav-back.

**Removed** the opt-in `store.subscribeDocument` / `store.subscribeQuery` capability (added in the same major and never released): cancellation no longer needs a manual subscription. Adapters still receive `find(ids, { signal })` — thread it into `fetch(url, { signal })` for a real network abort, or ignore it and interruption just discards the result.
