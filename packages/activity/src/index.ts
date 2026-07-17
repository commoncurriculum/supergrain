/**
 * @supergrain/activity — user-activity / presence tracking as a verified
 * state chart.
 *
 * A small, framework-free XState machine that tracks whether the user is
 * `active`, `idle`, or `hidden`, with two idle thresholds (a short signal
 * for presence/analytics and a longer "the user is gone" signal safe for
 * idle-disconnect). The value here is the *state chart*: the debounce,
 * visibility/focus, and double-fire edge cases live as declarative
 * transitions and are covered by tests, not hand-rolled timers.
 *
 * Public surface:
 *   ActivityTracker         — class wrapper: subscribe / on / onEvent /
 *                             attachTo / attachDOM
 *   attachActivityListeners — DOM bridge (focus/blur/visibility + input)
 *   activityMachine         — the raw XState machine (advanced use)
 */

export {
  ActivityTracker,
  type ActivityReactive,
  type ActivityTrackerOptions,
  type ActivityState,
  type IdleSink,
} from "./activity-tracker";

export { attachActivityListeners, type AttachActivityOptions } from "./dom-bridge";

export {
  activityMachine,
  ACTIVITY_EVENT_TYPES,
  type ActivityContext,
  type ActivityEvent,
  type ActivityEmitted,
  type ActivityInput,
} from "./machines/activity";
