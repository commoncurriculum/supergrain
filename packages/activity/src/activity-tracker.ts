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
 * states, not hand-rolled timers). Nothing about XState — no actor, no
 * events, no subscriptions — is exposed. The rest of the app reads
 * `tracker.state` fields inside an `effect` / `computed`, exactly like any
 * other Supergrain state:
 *
 *   const activity = new ActivityTracker();
 *   activity.attachDOM();
 *   effect(() => {
 *     console.log(activity.state.status);          // "active" | "idle" | "hidden"
 *     if (activity.state.longIdle) socket.pause();  // idle-disconnect, reactively
 *   });
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
