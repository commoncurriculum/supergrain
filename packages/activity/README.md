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
and `tracker.on(event, cb)`, the same transitions as one-shot events for
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

// The same transitions are also one-shot events (the push form of state):
activity.on("idle", () => track("went_idle"));
activity.on("returned", (e) => track("session_resumed", { awayMs: e.awayMs }));

// later
activity.destroy();
```

## Two surfaces: state and events

The chart's transitions are available two ways — pick whichever fits the
call site:

- **`tracker.state`** — a reactive object; _what's true now_. Read it in an
  `effect` / `computed` (or React's `useSignalEffect`) to render or react.
- **`tracker.on(event, cb)`** — the same transitions as _one-shot events_.
  The push form, for fire-and-forget consumers like analytics.

State is deduped (only changes on a real transition); events are the raw
per-transition stream. `returned` is the one event that also carries data no
lasting state holds (`awayMs`).

## `tracker.state`

A reactive `@supergrain/kernel` object with one field:

| Field    | Type                             | Meaning                                                     |
| -------- | -------------------------------- | ----------------------------------------------------------- |
| `status` | `"active" \| "idle" \| "hidden"` | Coarse activity. Chart substates collapse into these three. |

## `tracker.on(event, cb)`

Subscribe to an event; returns an unsubscribe function. **Every event carries
`from`** (the prior `status`) **and `at`** (`Date.now()` at the transition):

```ts
activity.on("idle", (e) => track("went_idle", { from: e.from, at: e.at }));
// e: { type: "idle", from: "active", at: 1723... }
```

| Event      | Extra payload        | Fires when                                              |
| ---------- | -------------------- | ------------------------------------------------------- |
| `active`   | —                    | Became active. Re-fires on continued input (throttled). |
| `idle`     | —                    | No input for `idleAfterMs`.                             |
| `hidden`   | —                    | Tab blurred / backgrounded.                             |
| `returned` | `{ awayMs: number }` | Came back to the tab after being hidden ≥ `longBlurMs`. |

## Constructor options

`idleAfterMs`, `longBlurMs`, `inputThrottleMs` — all optional, all with
sensible defaults.

## Lifecycle

- `attachDOM(target?)` — attach the DOM listeners that feed the chart
  (defaults to the global `document`; pass one outside the browser, where it
  throws rather than dereferencing a missing global). Idempotent; returns a
  detach function.
- `destroy()` — detach everything and stop the chart.
