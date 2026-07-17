---
"@supergrain/activity": minor
---

Add `@supergrain/activity`: user-activity / presence tracking as a verified
XState state chart (`active` / `idle` / `hidden`) with short and long idle
thresholds. The chart is fully wrapped, with two orthogonal surfaces:
`ActivityTracker.state`, a reactive `@supergrain/kernel` object (`status`,
`longIdle`) read inside `effect` / `computed`; and `ActivityTracker.on(event,
cb)` for discrete transient events (`returned`, with the away duration). Plus
`attachDOM()` to feed it from the browser.
