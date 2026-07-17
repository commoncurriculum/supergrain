import { createReactive } from "@supergrain/kernel";
import { createActor, type ActorRefFromLogic } from "xstate";

import { attachActivityListeners } from "./dom-bridge";
import { activityMachine } from "./machines/activity";

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
 *           analytics. Each event carries the prior status and a timestamp.
 *
 *   const activity = new ActivityTracker();
 *   activity.attachDOM();
 *   effect(() => console.log(activity.state.status)); // "active" | "idle" | "hidden"
 *   activity.on("idle", (e) => track("went_idle", { from: e.from, at: e.at }));
 */

export type ActivityStatus = "active" | "idle" | "hidden";

/** Reactive projection of the activity state chart. Read `status` inside an
 *  `effect` / `computed`; it updates as the chart transitions. */
export interface ActivityState {
  /** Coarse activity. The chart's hidden substates collapse into these three. */
  status: ActivityStatus;
}

/** Fields carried by every activity event. */
export interface ActivityEventMeta {
  /** The status the chart was in immediately before this transition. */
  from: ActivityStatus;
  /** When the transition occurred, epoch ms (`Date.now()`). */
  at: number;
}

/**
 * Activity events — the chart's transitions as discrete, one-shot
 * notifications. The same information `state` carries reactively, in push
 * form: use `state` to render "what's true now", `on` to log "this just
 * happened" (analytics, side effects). Every event includes `from` (prior
 * status) and `at` (timestamp).
 *
 *   active   — became active. Re-fires on continued input (throttled by the
 *              DOM bridge), where `from` is `"active"`.
 *   idle     — no input for `idleAfterMs`.
 *   hidden   — tab blurred / backgrounded.
 *   returned — came back to the tab after being hidden ≥ `longBlurMs`;
 *              `awayMs` is the elapsed hidden time (no lasting state holds it).
 */
export type ActivityEvent =
  | ({ type: "active" } & ActivityEventMeta)
  | ({ type: "idle" } & ActivityEventMeta)
  | ({ type: "hidden" } & ActivityEventMeta)
  | ({ type: "returned"; awayMs: number } & ActivityEventMeta);

type ActivityEventHandler = (event: ActivityEvent) => void;

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
  private listeners = new Map<ActivityEvent["type"], Set<ActivityEventHandler>>();

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

    // A single dispatch per chart emit: update the reactive `status` and fan
    // the transition out as an event, capturing the prior status as `from`.
    const advance = (to: ActivityStatus): ActivityEventMeta => {
      const from = this.state.status;
      this.state.status = to;
      return { from, at: Date.now() };
    };
    const subs = [
      this.actor.on("active", () => this.dispatch({ type: "active", ...advance("active") })),
      this.actor.on("idle", () => this.dispatch({ type: "idle", ...advance("idle") })),
      this.actor.on("hidden", () => this.dispatch({ type: "hidden", ...advance("hidden") })),
      this.actor.on("longBlurReturn", (e) =>
        this.dispatch({
          type: "returned",
          from: this.state.status,
          at: Date.now(),
          awayMs: e.blurDurationMs,
        }),
      ),
    ];
    this.detachers.push(() => {
      for (const s of subs) s.unsubscribe();
    });

    this.actor.start();
  }

  private dispatch(event: ActivityEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    // Deleting the current handler mid-iteration (self-unsubscribe) is safe
    // per the Set iterator spec, so no snapshot is needed.
    for (const handler of set) handler(event);
  }

  /** Subscribe to an activity event (see {@link ActivityEvent}) — the push
   *  counterpart to `state`. Fires once per chart transition; use it for
   *  fire-and-forget consumers like analytics. Returns an unsubscribe fn. */
  on<T extends ActivityEvent["type"]>(
    type: T,
    handler: (event: Extract<ActivityEvent, { type: T }>) => void,
  ): () => void {
    const set = this.listeners.get(type) ?? new Set<ActivityEventHandler>();
    this.listeners.set(type, set);
    set.add(handler as ActivityEventHandler);
    const detach = () => {
      set.delete(handler as ActivityEventHandler);
    };
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
