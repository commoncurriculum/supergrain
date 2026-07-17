---
"@supergrain/activity": minor
---

Add `@supergrain/activity`: user-activity / presence tracking as a verified
XState state chart (`active` / `idle` / `hidden`) with short and long idle
thresholds. The chart is fully wrapped — the only interface is
`ActivityTracker.state`, a reactive `@supergrain/kernel` object (`status`,
`longIdle`) read inside `effect` / `computed`, plus `attachDOM()` to feed it
from the browser.
