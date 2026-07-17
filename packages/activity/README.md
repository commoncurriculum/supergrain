# @supergrain/activity

User-activity / presence tracking as a **verified state chart**, exposed as a
reactive object.

A small [XState](https://stately.ai/docs/xstate) chart tracks whether the user
is `active`, `idle`, or `hidden`. The point of a state chart over hand-rolled
timers is safety: the debounce, focus/visibility, and double-fire edge cases
that plague ad-hoc presence code live here as declarative transitions with a
test suite.

The chart is **fully wrapped** — no actor or XState types leak out. Its
transitions are exposed two ways: `tracker.state`, an ordinary
`@supergrain/kernel` reactive object you read inside `effect` / `computed`,
and `tracker.on(toState, cb)`, the same transitions as one-shot events for
fire-and-forget consumers like analytics.

After `idleAfterMs` (default 15 s) with no input, `status` becomes `idle`; a
`BLUR`/`visibilitychange` makes it `hidden`; any input or focus returns it to
`active`.

## Install

```sh
pnpm add @supergrain/activity
```

## Usage

```ts
import { effect } from "@supergrain/kernel";
import { ActivityTracker } from "@supergrain/activity";

const activity = new ActivityTracker();
activity.attachDOM(); // wire focus/blur/visibility + user-input events

// Reactive: re-runs on every transition.
effect(() => {
  console.log(activity.state.status); // "active" | "idle" | "hidden"
});

// The same transitions are also one-shot events, keyed by destination state:
activity.on("idle", (e) => track("went_idle", { after: e.durationMs }));

// "came back after a long absence" = active, from hidden, for a while:
activity.on("active", (e) => {
  if (e.fromState === "hidden" && e.durationMs > 120_000) track("session_resumed");
});

// later
activity.destroy();
```

## Two surfaces: state and events

The chart's transitions are available two ways — pick whichever fits the
call site:

- **`tracker.state`** — a reactive object; _what's true now_. Read it in an
  `effect` / `computed` (or React's `useSignalEffect`) to render or react.
- **`tracker.on(toState, cb)`** — the same transitions as _one-shot events_,
  keyed by the state entered. The push form, for fire-and-forget consumers
  like analytics.

State is deduped (only changes on a real transition); events are the raw
per-transition stream, each carrying where the user came from and how long
they were there.

## `tracker.state`

A reactive `@supergrain/kernel` object with one field:

| Field    | Type                             | Meaning                                                     |
| -------- | -------------------------------- | ----------------------------------------------------------- |
| `status` | `"active" \| "idle" \| "hidden"` | Coarse activity. Chart substates collapse into these three. |

## `tracker.on(toState, cb)`

Subscribe to transitions **into** a state; returns an unsubscribe function.
`toState` is one of `"active" | "idle" | "hidden"` — the same values as
`state.status`. Every event is the same flat shape:

```ts
activity.on("active", (e) => …);
// e: { fromState: "hidden", toState: "active", at: 1723…, durationMs: 45000 }
```

| Field        | Type                             | Meaning                                |
| ------------ | -------------------------------- | -------------------------------------- |
| `fromState`  | `"active" \| "idle" \| "hidden"` | The status before this transition.     |
| `toState`    | `"active" \| "idle" \| "hidden"` | The status entered (the `on` key).     |
| `at`         | `number`                         | `Date.now()` at the transition.        |
| `durationMs` | `number`                         | How long the chart was in `fromState`. |

`active` re-fires on continued input (throttled), where `fromState` is
`"active"`. There's no dedicated "returned" event — a return from a long
absence is simply `active` with `fromState: "hidden"` and a large `durationMs`,
so the consumer picks the threshold.

## `tracker.currentDurationMs()`

How long the chart has been in its **current** `status`, computed on demand
(no ticking timer) — the live counterpart to the event `durationMs`, which
reports the state just left. While `active`, continued input re-enters the
state, so this is time since the last input; while `idle` / `hidden` it's the
full time in that state.

```ts
if (activity.state.status === "idle" && activity.currentDurationMs() > 60_000) …
```

## Constructor options

`idleAfterMs`, `inputThrottleMs` — both optional, both with sensible defaults.

## Lifecycle

- `attachDOM(target?)` — attach the DOM listeners that feed the chart
  (defaults to the global `document`; pass one outside the browser, where it
  throws rather than dereferencing a missing global). Idempotent; returns a
  detach function.
- `destroy()` — detach everything and stop the chart.
