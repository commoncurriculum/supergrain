import { batch, createReactive } from "@supergrain/kernel";
import { createActor, type ActorRefFromLogic } from "xstate";

import { attachActivityListeners } from "./dom-bridge";
import { activityMachine } from "./machines/activity";

/**
 * ActivityTracker — wraps the ActivityMachine state chart and exposes it as
 * a single reactive @supergrain/kernel object at `tracker.state`.
 *
 * The chart stays fully internal: XState owns the verified transitions (the
 * debounce, focus/visibility, and double-fire edge cases live as chart
 * states, not hand-rolled timers). No actor is exposed. There are two
 * orthogonal read surfaces:
 *
 *   state — a reactive @supergrain/kernel object; what's true *now*. Read its
 *           fields inside an `effect` / `computed` like any Supergrain state.
 *   on    — discrete transient events (see ActivityEvent); moments that
 *           aren't expressible as state, delivered as one-shot callbacks.
 *
 *   const activity = new ActivityTracker();
 *   activity.attachDOM();
 *   effect(() => {
 *     console.log(activity.state.status);          // "active" | "idle" | "hidden"
 *     if (activity.state.longIdle) socket.pause();  // idle-disconnect, reactively
 *   });
 *   activity.on("returned", (e) => track("resumed", { awayMs: e.awayMs }));
 */

export type ActivityStatus = "active" | "idle" | "hidden";

/** Reactive projection of the activity state chart. Read these fields inside
 *  an `effect` / `computed`; they update as the chart transitions. */
export interface ActivityState {
  /** Coarse activity. The chart's substates (idle.recent/long, hidden.*)
   *  collapse into these three — read `longIdle` for the long-threshold
   *  signal that `status` alone can't express. */
  status: ActivityStatus;
  /** True once the user has been gone for `longIdleAfterMs` (the chart is in
   *  `idle.long` or `hidden.dormant`) — the safe trigger for idle-disconnect,
   *  distinct from the short `idle` status. */
  longIdle: boolean;
}

/**
 * Discrete activity events — the moments that aren't expressible as state.
 * Orthogonal to `state`: `state` is what's true now (read/observe it), an
 * event is a one-shot notification with a payload (subscribe via `on`).
 *
 *   returned — the user came back to the tab after a long absence (hidden for
 *              ≥ `longBlurMs`). `awayMs` is how long they were gone. There is
 *              no "just returned" *state*, so this can only be an event.
 */
export interface ActivityEvent {
  type: "returned";
  awayMs: number;
}

/** Public event type → the chart's internal emitted event. */
const MACHINE_EMIT: Record<ActivityEvent["type"], "longBlurReturn"> = {
  returned: "longBlurReturn",
};

export interface ActivityTrackerOptions {
  /** No input for this long → `idle` (a presence signal, never a teardown).
   *  Default 15_000 (15 s). */
  idleAfterMs?: number | undefined;
  /** Idle/hidden for this long → `longIdle` flips true. Default 900_000 (15 min). */
  longIdleAfterMs?: number | undefined;
  longBlurMs?: number | undefined;
  /** Min ms between USER_INPUT events forwarded from the DOM bridge.
   *  Default 1000. */
  inputThrottleMs?: number | undefined;
}

function toStatus(value: unknown): ActivityStatus {
  if (typeof value === "string") return value as ActivityStatus;
  const [key] = Object.keys(value as Record<string, unknown>);
  /* c8 ignore next -- a chart value is a string or a non-empty object, so key is always present */
  return (key ?? "active") as ActivityStatus;
}

/** The chart's two long-threshold substates, which `toStatus` collapses away:
 *  `idle.long` and `hidden.dormant`. */
function isLongIdle(value: unknown): boolean {
  if (typeof value === "string") return false;
  const v = value as Record<string, string | undefined>;
  return v["idle"] === "long" || v["hidden"] === "dormant";
}

export class ActivityTracker {
  /** The tracker's entire read surface: a reactive @supergrain/kernel object.
   *  Observe `state.status` / `state.longIdle` inside `effect` / `computed`. */
  readonly state: ActivityState;

  private actor: ActorRefFromLogic<typeof activityMachine>;
  private domDetach: (() => void) | null = null;
  private detachers: Array<() => void> = [];
  private inputThrottleMs: number;

  constructor(opts: ActivityTrackerOptions = {}) {
    this.inputThrottleMs = opts.inputThrottleMs ?? 1000;
    this.actor = createActor(activityMachine, {
      input: {
        idleAfterMs: opts.idleAfterMs,
        longIdleAfterMs: opts.longIdleAfterMs,
        longBlurMs: opts.longBlurMs,
      },
    });

    const snapshot = this.actor.getSnapshot();
    this.state = createReactive<ActivityState>({
      status: toStatus(snapshot.value),
      longIdle: isLongIdle(snapshot.value),
    });

    // The actor drives the reactive projection: every chart transition writes
    // the derived fields into `state` (batched, and only on change so equal
    // transitions don't churn observers).
    const sub = this.actor.subscribe((snap) => {
      const status = toStatus(snap.value);
      const longIdle = isLongIdle(snap.value);
      batch(() => {
        if (this.state.status !== status) this.state.status = status;
        if (this.state.longIdle !== longIdle) this.state.longIdle = longIdle;
      });
    });
    this.detachers.push(() => sub.unsubscribe());

    this.actor.start();
  }

  /** Subscribe to a discrete activity event (see {@link ActivityEvent}).
   *  Unlike `state`, these are transient one-shot notifications carrying a
   *  payload — use them for analytics ("session resumed after N ms away"),
   *  not for tracking current state. Returns an unsubscribe function. */
  on<T extends ActivityEvent["type"]>(
    type: T,
    handler: (event: Extract<ActivityEvent, { type: T }>) => void,
  ): () => void {
    const sub = this.actor.on(MACHINE_EMIT[type], (e) => {
      handler({ type: "returned", awayMs: e.blurDurationMs } as Extract<
        ActivityEvent,
        { type: T }
      >);
    });
    const detach = () => sub.unsubscribe();
    this.detachers.push(detach);
    return detach;
  }

  /** Attach DOM listeners (focus / blur / visibilitychange / 10 user events)
   *  that feed the chart. Idempotent; returns a detach function. */
  attachDOM(target: Document = document): () => void {
    if (this.domDetach) return this.domDetach;
    this.domDetach = attachActivityListeners(this.actor, target, {
      inputThrottleMs: this.inputThrottleMs,
    });
    return this.domDetach;
  }

  destroy(): void {
    this.domDetach?.();
    this.domDetach = null;
    for (const d of this.detachers) d();
    this.detachers = [];
    this.actor.stop();
  }
}
