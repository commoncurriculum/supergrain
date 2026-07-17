/**
 * @supergrain/activity — user-activity / presence tracking as a verified
 * state chart, exposed as a reactive object.
 *
 * A small XState state chart tracks whether the user is `active`, `idle`, or
 * `hidden`, with two idle thresholds (a short signal for presence and a
 * longer "the user is gone" signal safe for idle-disconnect). The value is
 * the *chart*: the debounce, visibility/focus, and double-fire edge cases
 * live as declarative transitions covered by tests, not hand-rolled timers.
 *
 * The chart is fully wrapped. The only interface is `ActivityTracker.state`,
 * a reactive @supergrain/kernel object read inside `effect` / `computed`.
 */

export {
  ActivityTracker,
  type ActivityState,
  type ActivityStatus,
  type ActivityTrackerOptions,
} from "./activity-tracker";
