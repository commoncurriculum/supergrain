# @supergrain/activity

User-activity / presence tracking as a **verified state chart**, exposed as a
reactive object.

A small [XState](https://stately.ai/docs/xstate) chart tracks whether the user
is `active`, `idle`, or `hidden`. The point of a state chart over hand-rolled
timers is safety: the debounce, focus/visibility, and double-fire edge cases
that plague ad-hoc presence code live here as declarative transitions with a
test suite.

The chart is **fully wrapped**. The only interface is `tracker.state` — an
ordinary `@supergrain/kernel` reactive object. There is no event API, no
subscribe, no actor: you read fields inside `effect` / `computed`, exactly
like any other Supergrain state.

Two idle thresholds, deliberately kept apart:

- **`idleAfterMs`** (default 15 s) — "the user stopped interacting"; sets
  `status: "idle"`. A presence signal, **never** a teardown trigger.
- **`longIdleAfterMs`** (default 15 min) — "the user is gone"; sets
  `longIdle: true`. Safe to act on for idle-disconnect.

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

effect(() => {
  console.log(activity.state.status); // "active" | "idle" | "hidden"
});

// Idle-disconnect is just an effect on the reactive field — no callbacks:
effect(() => {
  if (activity.state.longIdle) socket.pause();
  else socket.resume();
});

// later
activity.destroy();
```

## `tracker.state`

A reactive `@supergrain/kernel` object with two fields:

| Field      | Type                             | Meaning                                                                  |
| ---------- | -------------------------------- | ------------------------------------------------------------------------ |
| `status`   | `"active" \| "idle" \| "hidden"` | Coarse activity. Chart substates collapse into these three.              |
| `longIdle` | `boolean`                        | User gone ≥ `longIdleAfterMs` (chart in `idle.long` / `hidden.dormant`). |

## Constructor options

`idleAfterMs`, `longIdleAfterMs`, `longBlurMs`, `inputThrottleMs` — all
optional, all with sensible defaults.

## Lifecycle

- `attachDOM(target = document)` — attach the DOM listeners that feed the
  chart. Idempotent; returns a detach function.
- `destroy()` — detach everything and stop the chart.
