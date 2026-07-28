---
"@supergrain/kernel": minor
---

Faster list teardown and swap tracking in `@supergrain/kernel/react`.

**`tracked()` now defers effect teardown past the next paint.** Unlinking an
effect from the signal graph is bookkeeping with no observable output, so
running it inside React's unmount commit put O(subscriptions) work between a
state change and the frame that shows it — unmounting a 1,000-row list tore
down 1,000 effects before the browser could present the empty table. Disposers
are now queued and flushed in the first macrotask after the next frame.

Every queued disposer still runs: the flush is deferred, never skipped, so
subscriber lists cannot leak. The observable difference is a short window after
unmount in which a component's effect can still fire; for `tracked()` that means
a `forceUpdate` on an unmounted component, which React ignores. If you dispose
effects yourself and need them to stop firing at exactly the unmount commit,
guard the effect body with your own disposed flag.

**Parent-mode `For` now uses a single array-level subscription for swaps.** A
new internal `$ELEMENTS` signal answers "some element was replaced in place" for
the whole array, replacing one subscription per index in the O(1)-swap effect.
Rendering 10,000 rows no longer creates 10,000 per-index dependency links for
swap tracking. Structural changes (push, splice, length, new array) are
unaffected — they still notify through the version and ownKeys signals. No
public API change; behavior is identical.
