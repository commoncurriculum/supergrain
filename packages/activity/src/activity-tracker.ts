import { createReactive } from "@supergrain/kernel";
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
 *   effect(() => console.log(activity.state.status)); // "active" | "idle" | "hidden"
 *   activity.on("returned", (e) => track("resumed", { awayMs: e.awayMs }));
 */

export type ActivityStatus = "active" | "idle" | "hidden";

/** Reactive projection of the activity state chart. Read `status` inside an
 *  `effect` / `computed`; it updates as the chart transitions. */
export interface ActivityState {
  /** Coarse activity. The chart's hidden substates collapse into these three. */
  status: ActivityStatus;
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
 *   hidden   — tab blurred / backgrounded.
 *   returned — came back to the tab after being hidden ≥ `longBlurMs`;
 *              `awayMs` is the elapsed hidden time (no lasting state holds it).
 */
export type ActivityEvent =
  | { type: "active" }
  | { type: "idle" }
  | { type: "hidden" }
  | { type: "returned"; awayMs: number };

/** Public event name → the chart's internal emitted event name. Identity for
 *  all but `returned`, whose payload field is renamed too (see toPublicEvent). */
const EMIT_NAME: Record<ActivityEvent["type"], ActivityEmitted["type"]> = {
  active: "active",
  idle: "idle",
  hidden: "hidden",
  returned: "longBlurReturn",
};

function toPublicEvent(e: ActivityEmitted): ActivityEvent {
  return e.type === "longBlurReturn"
    ? { type: "returned", awayMs: e.blurDurationMs }
    : { type: e.type };
}

export interface ActivityTrackerOptions {
  /** No input for this long → `idle` (a presence signal). Default 15_000 (15 s). */
  idleAfterMs?: number | undefined;
  /** A hidden period this long counts as a real absence, so returning emits
   *  `returned`. Default 120_000 (2 min). */
  longBlurMs?: number | undefined;
  /** Min ms between USER_INPUT events forwarded from the DOM bridge.
   *  Default 1000. */
  inputThrottleMs?: number | undefined;
}

export class ActivityTracker {
  /** The tracker's reactive read surface: a @supergrain/kernel object.
   *  Observe `state.status` inside `effect` / `computed`. */
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
        longBlurMs: opts.longBlurMs,
      },
    });

    // The chart starts in `active` (see machine `initial`).
    this.state = createReactive<ActivityState>({ status: "active" });

    // Project the chart's typed status emits into the reactive field.
    const setStatus = (status: ActivityStatus) => {
      this.state.status = status;
    };
    const subs = [
      this.actor.on("active", () => setStatus("active")),
      this.actor.on("idle", () => setStatus("idle")),
      this.actor.on("hidden", () => setStatus("hidden")),
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
