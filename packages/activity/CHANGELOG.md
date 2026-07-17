# @supergrain/activity

## 0.1.0

### Minor Changes

- 0bace93: Add `@supergrain/activity`: user-activity / presence tracking as a verified
  XState state chart (`active` / `idle` / `hidden`). The chart is fully wrapped,
  with two orthogonal surfaces over the same transitions:
  `ActivityTracker.state`, a reactive `@supergrain/kernel` object (`status`)
  read inside `effect` / `computed`; and `ActivityTracker.on(toState, cb)`,
  which delivers each transition as a one-shot event keyed by destination state,
  carrying `fromState`, `toState`, `at`, and `durationMs` (how long the prior
  state lasted) — for fire-and-forget consumers like analytics. Plus
  `currentDurationMs()` for how long the current state has lasted so far, and
  `attachDOM()` to feed it from the browser.
