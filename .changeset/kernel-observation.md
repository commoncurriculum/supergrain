---
"@supergrain/kernel": minor
---

Add a reactive-observation lifecycle primitive and own the reactive system.

The kernel now owns its primitive layer (`signal` / `computed` / `effect` / `batch`) on top of `alien-signals/system`'s `createReactiveSystem(...)` instead of importing the high-level operators from `alien-signals` directly. The graph algorithm (`link` / `unlink` / `propagate` / `checkDirty`) is still delegated to alien-signals — only the thin operator layer is owned, so the kernel can observe when a reactive node loses its last subscriber. All reactive semantics (fine-grained tracking, batching, Map/Set coalescing, `effect` cleanup) are unchanged.

**New: `onObservationChange`.** Register a callback fired when a reactive node transitions observed→unobserved (its last subscriber is removed) and, optionally, unobserved→observed (it gains its first):

```ts
import { onObservationChange, getObservationNode } from "@supergrain/kernel";

const node = getObservationNode(reactiveProxy); // dedicated, never-written liveness node
const unregister = onObservationChange(node, {
  onUnobserved: () => scheduleCleanup(), // defer destructive work; re-check on a timer
  onObserved: () => cancelCleanup(),
});
```

`getObservationNode(proxy)` returns a proxy's dedicated liveness node (created lazily, never written, so it never causes a re-render). The sharp tools `trackNode` (subscribe the active sub) and `isObserved` are available from `@supergrain/kernel/internal`. The dispatch is gated behind counters that stay `0` until a handler is registered, so the hot path is unchanged when observation is unused.

`@supergrain/silo` uses this to cancel an in-flight fetch automatically when no component observes a handle anymore — no `useEffect`, no manual `subscribe*`.
