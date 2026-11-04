---
"@supergrain/activity": patch
---

Fix a subscriber leak in `ActivityTracker.on()`.

Every `on()` call recorded a second, private reference to the subscription in
addition to the unsubscribe function it returned. Calling the returned function
removed the handler from the dispatch set but not that private reference, so a
long-lived tracker accumulated one dead closure per subscription for its whole
life, each pinning its handler and everything the handler closed over. A
component that subscribes on mount and unsubscribes on unmount leaked one entry
per mount.

The private bookkeeping is gone entirely rather than being kept in sync:
`destroy()` releases subscribers by clearing the listener registry in one step,
which is all it ever needed. `destroy()` now also clears that registry, which it
previously left populated.

No API change — `on()` returns the same unsubscribe function and behaves the
same.
