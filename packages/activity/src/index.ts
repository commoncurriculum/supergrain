/**
 * @supergrain/activity — user-activity / presence tracking as a verified
 * state chart, exposed as a reactive object.
 *
 * A small XState state chart tracks whether the user is `active`, `idle`, or
 * `hidden`. The value is the *chart*: the debounce, visibility/focus, and
 * double-fire edge cases live as declarative transitions covered by tests,
 * not hand-rolled timers.
 *
 * The chart is fully wrapped and exposed two ways over the same transitions:
 * `ActivityTracker.state` (a reactive @supergrain/kernel object read inside
 * `effect` / `computed`) and `ActivityTracker.on(event, cb)` (the transitions
 * as one-shot events, each with the prior status and a timestamp).
 */

export {
  ActivityTracker,
  type ActivityEvent,
  type ActivityEventMeta,
  type ActivityState,
  type ActivityStatus,
  type ActivityTrackerOptions,
} from "./activity-tracker";
