# FAILED: Mill array removal by splicing the proxy (+ patching the kernel delete trap)

> **STATUS: FAILED / REVERTED.** Rewriting mill's `$pull`/`$pullAll` to call
> `splice()` on the reactive **proxy** — and then patching the kernel's array
> `deleteProperty` trap to make it behave — broke the kernel's profiler
> accounting tests and reintroduced per-update proxy-navigation overhead. The
> kernel was **not** missing anything. Reverted. mill instead operates on the
> raw object via the kernel's standalone write primitives (`compactArray`),
> which is what shipped.

**Date:** June 2026

## Goal

Finish the `$pullAll` operator and remove the hand-rolled signal-replication
"hacks" from `@supergrain/mill` (`notifyArrayRemoval`, `syncIndexedSignals`, and
the manual `bumpVersion` / `bumpOwnKeysSignal` / `profileSignalWrite` juggling)
so that updates "just use the kernel."

## What Was Tried

1. Rewrote `update()` to drop the `unwrap()` and operate **on the proxy**,
   expressing array removal as `proxyArray.splice(i, 1)` and letting the proxy
   traps drive every signal.
2. A mill test failed — `$pull leaves unchanged indexed signals alone`: after
   removing an element, an effect subscribed to the now-vacated tail index kept
   reading the stale old value.
3. Traced it to `writeHandler.deleteProperty` in `packages/kernel/src/write.ts`,
   whose array branch does a deliberate **silent delete** (only bumps
   `ownKeys`). So I patched that branch to also fire the vacated index's signal
   → `undefined`.

## Why It Failed

- **Proxy navigation is not free.** Operating on the proxy means `update()`
  re-resolves each path segment through the get trap, incurring a signal
  **read** per segment on every update. The kernel's profiler accounting tests
  (`packages/kernel/tests/read/array.test.ts`) pin those read counts and assume
  `update()` adds **zero** navigation reads. Eight of them broke. That is a real
  performance regression, not a test artifact — the original mill deliberately
  unwraps to raw precisely to avoid it.
- **The kernel patch was unnecessary (and out of scope).** The "silent delete"
  is intentional and documented: `splice`/`pop`/`shift` update per-index signals
  via element **moves** through the `set` trap. The only thing it doesn't notify
  is a subscriber pinned to the exact vacated tail index — a narrow case mill
  never hits. The kernel is well tested and was correct; the patch was reverted
  (net kernel diff: empty).

## What We Did Instead (shipped)

- `update()` keeps unwrapping to raw and runs inside the public `batch()`.
- `notifyArrayRemoval` / `syncIndexedSignals` are gone. `$pull`/`$pullAll` use
  `compactArray`: `setProperty` to shift survivors down + the **standalone**
  `deleteProperty` helper to remove the vacated tail + a `length` write. Crucial
  detail: the standalone `deleteProperty` (exported via
  `@supergrain/kernel/internal`, **not** the proxy trap) already fires the
  removed key's signal → `undefined`, so removal is correct with **no** kernel
  change.
- All `c8 ignore` pragmas removed (`incrementValue` rewritten); `operators.ts`
  and `path.ts` at 100% coverage.

## Aside: not using mingo

We are **not** using [mingo](https://github.com/kofrasa/mingo) or any external
operator library. mingo mutates plain objects and would bypass the kernel's
signal layer, forcing a diff/reconcile pass afterward. Broader Mongo
compatibility means adding more operators that call the kernel primitives — not
delegating mutation to a library that doesn't drive signals.

## Open item (deliberately not done)

The proxy trap's silent array-delete means `store.items.splice()` called
**directly on the proxy** still won't notify a subscriber pinned to the vacated
index. Native array semantics (a shorter array; out-of-bounds reads return
`undefined`) suggest firing `undefined` would be reasonable — but this is the hot
delete path the js-framework-benchmark drives (remove/clear), so it needs a
real before/after benchmark before any change. Do not change it casually.
