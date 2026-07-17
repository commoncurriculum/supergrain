import { batch, createReactive } from "@supergrain/kernel";
import { createActor, type ActorRefFromLogic } from "xstate";

import { attachActivityListeners } from "./dom-bridge";
import { activityMachine, type ActivityEmitted } from "./machines/activity";

/**
 * ActivityTracker — wraps the ActivityMachine state chart and exposes it two
 * orthogonal ways: `state` (reactive) and `on` (events).
 *
 * The chart stays fully internal: XState owns the verified transitions (the
 * debounce, focus/visibility, and double-fire edge cases live as chart
 * states, not hand-rolled timers). No actor is exposed.
 *
 *   state — a reactive @supergrain/kernel object; what's true *now*. Read its
 *           fields inside an `effect` / `computed` like any Supergrain state.
 *   on    — the same transitions as one-shot events; the imperative
 *           counterpart to `state`, for fire-and-forget consumers like
 *           analytics. `returned` additionally carries the away-duration.
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
 * Activity events — the chart's transitions as discrete, one-shot
 * notifications. The same information `state` carries reactively, in push
 * form: use `state` to render "what's true now", `on` to log "this just
 * happened" (analytics, side effects).
 *
 *   active   — became active. Re-fires on continued input (throttled by the
 *              DOM bridge); `state.status` is the deduped view if you only
 *              want the transition.
 *   idle     — no input for `idleAfterMs`.
 *   longIdle — gone (idle or hidden) for `longIdleAfterMs`.
 *   hidden   — tab blurred / backgrounded.
 *   returned — came back to the tab after being hidden ≥ `longBlurMs`;
 *              `awayMs` is the elapsed hidden time (no lasting state holds it).
 */
export type ActivityEvent =
  | { type: "active" }
  | { type: "idle" }
  | { type: "longIdle" }
  | { type: "hidden" }
  | { type: "returned"; awayMs: number };

/** Public event name → the chart's internal emitted event name. Identity for
 *  all but `returned`, whose payload field is renamed too (see toPublicEvent). */
const EMIT_NAME: Record<ActivityEvent["type"], ActivityEmitted["type"]> = {
  active: "active",
  idle: "idle",
  longIdle: "longIdle",
  hidden: "hidden",
  returned: "longBlurReturn",
};

function toPublicEvent(e: ActivityEmitted): ActivityEvent {
  return e.type === "longBlurReturn"
    ? { type: "returned", awayMs: e.blurDurationMs }
    : { type: e.type };
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

    // The chart starts in `active` (see machine `initial`).
    this.state = createReactive<ActivityState>({ status: "active", longIdle: false });

    // Project the chart's typed emitted events into the reactive fields. The
    // three status events also clear `longIdle` (you can't be long-idle while
    // active/just-idle/just-hidden); the `longIdle` event only raises it.
    const enter = (status: ActivityStatus) =>
      batch(() => {
        this.state.status = status;
        this.state.longIdle = false;
      });
    const subs = [
      this.actor.on("active", () => enter("active")),
      this.actor.on("idle", () => enter("idle")),
      this.actor.on("hidden", () => enter("hidden")),
      this.actor.on("longIdle", () => {
        this.state.longIdle = true;
      }),
    ];
    this.detachers.push(() => {
      for (const s of subs) s.unsubscribe();
    });

    this.actor.start();
  }

  /** Subscribe to an activity event (see {@link ActivityEvent}) — the push
   *  counterpart to `state`. Fires once per chart transition; use it for
   *  fire-and-forget consumers like analytics. Returns an unsubscribe fn. */
  on<T extends ActivityEvent["type"]>(
    type: T,
    handler: (event: Extract<ActivityEvent, { type: T }>) => void,
  ): () => void {
    // EMIT_NAME[type] yields only the machine event `type` maps to, so the
    // projected public event is always the requested variant.
    const sub = this.actor.on(EMIT_NAME[type], (e) => {
      handler(toPublicEvent(e) as Extract<ActivityEvent, { type: T }>);
    });
    const detach = () => sub.unsubscribe();
    this.detachers.push(detach);
    return detach;
  }

  /** Attach DOM listeners (focus / blur / visibilitychange / 10 user events)
   *  that feed the chart. Idempotent; returns a detach function. Pass a
   *  `target` in non-DOM environments — it throws rather than dereferencing a
   *  missing global `document`. */
  attachDOM(target?: Document): () => void {
    if (this.domDetach) return this.domDetach;
    const doc: Document | undefined = target ?? globalThis.document;
    if (!doc) {
      throw new Error(
        "ActivityTracker.attachDOM: no document available — pass one explicitly outside the browser.",
      );
    }
    this.domDetach = attachActivityListeners(this.actor, doc, {
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
