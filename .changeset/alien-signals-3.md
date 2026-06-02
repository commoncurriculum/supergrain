---
"@supergrain/kernel": major
"@supergrain/mill": patch
"@supergrain/husk": patch
---

Upgrade the reactive core from `alien-signals` 2.0.7 to 3.2.1.

**Breaking — `effect` cleanup semantics.** `effect(fn)` (re-exported from `@supergrain/kernel`, and the engine behind `useSignalEffect`) now treats `fn`'s return value as a **cleanup function**: it runs before each re-run and once on dispose, matching React's `useEffect` mental model. A callback that returns a non-function value will throw `"cleanup is not a function"` on its next run — so read signals for subscription with a statement body or `void`:

```ts
effect(() => void store.count); // subscribe-only, no cleanup
effect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id); // cleanup
});
```

`useSignalEffect(fn)` now accepts `fn: () => void | (() => void)` and wires that cleanup to the component lifecycle.

**Internal rename.** alien-signals renamed `getCurrentSub`/`setCurrentSub` to `getActiveSub`/`setActiveSub`; `@supergrain/kernel/internal` now re-exports the new names. `ReactiveNode` is imported from `alien-signals/system`. No change to the public package-root API (these primitives were never exported from it).

All reactive semantics (fine-grained tracking, batching, Map/Set notification coalescing) are unchanged — verified across the kernel, mill, husk, and silo test suites.
