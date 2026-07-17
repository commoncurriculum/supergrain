---
"@supergrain/activity": minor
---

Add `@supergrain/activity`: user-activity / presence tracking as a verified
XState state chart (`active` / `idle` / `hidden`). The chart is fully wrapped,
with two orthogonal surfaces over the same transitions:
`ActivityTracker.state`, a reactive `@supergrain/kernel` object (`status`)
read inside `effect` / `computed`; and `ActivityTracker.on(event, cb)` for the
transitions as one-shot events (`active` / `idle` / `hidden` / `returned`, the
last carrying the away duration) for fire-and-forget consumers like analytics.
Plus `attachDOM()` to feed it from the browser.
