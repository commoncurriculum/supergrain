# @supergrain/activity

User-activity / presence tracking as a **verified state chart**.

A small, framework-free [XState](https://stately.ai/docs/xstate) machine that
tracks whether the user is `active`, `idle`, or `hidden`. The point of doing
this as a state chart rather than hand-rolled timers is safety: the debounce,
focus/visibility, and double-fire edge cases that plague ad-hoc presence code
live here as declarative transitions with a test suite, not scattered
`setTimeout`s.

Two idle thresholds, deliberately kept apart:

- **`idleAfterMs`** (default 15 s) — "the user stopped interacting". A signal
  for presence / analytics. **Never** a teardown trigger.
- **`longIdleAfterMs`** (default 15 min) — "the user is gone". Emits
  `longIdle`, which `attachTo` can forward to something that pauses a
  connection.

## Install

```sh
pnpm add @supergrain/activity
```

## Usage

The chart runs on XState internally; the app never touches it. The outward
interface is `tracker.reactive` — an ordinary `@supergrain/kernel` reactive
object you read inside `effect` / `computed`:

```ts
import { effect } from "@supergrain/kernel";
import { ActivityTracker } from "@supergrain/activity";

const activity = new ActivityTracker();
activity.attachDOM(); // wire focus/blur/visibility + user-input events

// Reactive — re-runs whenever the chart transitions:
effect(() => {
  console.log("activity:", activity.reactive.state); // "active" | "idle" | "hidden"
  if (activity.reactive.longIdle) console.log("user is gone");
});

// later
activity.destroy();
```

For analytics you can also tap the raw emitted stream — the long thresholds
and blur duration that the coarse `reactive.state` collapses away:

```ts
activity.on("longIdle", () => track("session_idle"));
activity.on("longBlurReturn", (e) => track("session_resumed", { awayMs: e.blurDurationMs }));
activity.onEvent((e) => track(`activity_${e.type}`)); // whole stream

// Or a plain push subscription outside a reactive context:
activity.subscribe((state) => console.log("activity:", state));
```

### Idle-disconnect

`attachTo` forwards the **long**-idle signal (not the 15 s one) to anything
with `notifyIdle()` / `notifyActive()`:

```ts
activity.attachTo({
  notifyIdle: () => socket.pause(),
  notifyActive: () => socket.resume(),
});
```

## API

| Member                       | Description                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `reactive`                   | Reactive `@supergrain/kernel` object: `{ state, longIdle }`. The intended interface to the app.  |
| `new ActivityTracker(opts?)` | `idleAfterMs`, `longIdleAfterMs`, `longBlurMs`, `inputThrottleMs`                                |
| `attachDOM(target?)`         | Attach focus/blur/visibility + throttled user-input listeners. Returns a detach fn.              |
| `subscribe(cb)`              | Coarse state `active \| idle \| hidden`, fired immediately then on change (deduped).             |
| `on(type, cb)`               | One emitted event by name (`active`/`idle`/`longIdle`/`hidden`/`longBlurReturn`), typed payload. |
| `onEvent(cb)`                | The entire emitted stream.                                                                       |
| `attachTo(sink)`             | Forward long-idle/active to a `notifyIdle`/`notifyActive` sink.                                  |
| `state`                      | Current coarse state.                                                                            |
| `destroy()`                  | Detach everything and stop the actor.                                                            |

Advanced consumers can import the raw `activityMachine` (and its
`ActivityContext` / `ActivityEvent` / `ActivityEmitted` types) directly.
