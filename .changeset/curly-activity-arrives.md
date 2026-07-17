---
"@supergrain/activity": minor
---

Add `@supergrain/activity`: user-activity / presence tracking as a verified
XState state chart (`active` / `idle` / `hidden`). The chart is fully wrapped,
with two orthogonal surfaces over the same transitions:
`ActivityTracker.state`, a reactive `@supergrain/kernel` object (`status`)
read inside `effect` / `computed`; and `ActivityTracker.on(event, cb)` for the
transitions as one-shot events (`active` / `idle` / `hidden` / `returned`),
each carrying `from` (the prior status) and `at` (a timestamp), plus `awayMs`
on `returned` — for fire-and-forget consumers like analytics. Plus
`attachDOM()` to feed it from the browser.
