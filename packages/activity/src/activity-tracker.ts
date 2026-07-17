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
 *   state — a reactive @supergrain/kernel object; what's true *now*. Read
 *           `state.status` inside an `effect` / `computed`.
 *   on    — the same transitions as one-shot events, keyed by destination
 *           state; the push counterpart to `state`, for fire-and-forget
 *           consumers like analytics.
 *
 *   const activity = new ActivityTracker();
 *   activity.attachDOM();
 *   effect(() => console.log(activity.state.status)); // "active" | "idle" | "hidden"
 *   // "came back after a long absence" = returning to active from hidden:
 *   activity.on("active", (e) => {
 *     if (e.fromState === "hidden" && e.durationMs > 120_000) track("resumed");
 *   });
 */

export type ActivityStatus = "active" | "idle" | "hidden";

/** Reactive projection of the activity state chart. Read `status` inside an
 *  `effect` / `computed`; it updates as the chart transitions. */
export interface ActivityState {
  /** Coarse activity: the current chart state. */
  status: ActivityStatus;
}

/**
 * An activity transition, delivered to `on(toState, …)` listeners. The push
 * form of `state`: subscribe by destination state and read where the user
 * came from and how long they were there.
 */
export interface ActivityEvent {
  /** The status the chart was in before this transition. */
  fromState: ActivityStatus;
  /** The status entered — also the `on` key this event was delivered to. */
  toState: ActivityStatus;
  /** When the transition occurred, epoch ms (`Date.now()`). */
  at: number;
  /** How long the chart was in `fromState` before this transition, ms. */
  durationMs: number;
}

type ActivityEventHandler = (event: ActivityEvent) => void;

export interface ActivityTrackerOptions {
  /** No input for this long → `idle` (a presence signal). Default 15_000 (15 s). */
  idleAfterMs?: number | undefined;
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
  private listeners = new Map<ActivityStatus, Set<ActivityEventHandler>>();
  private enteredAt = Date.now();

  constructor(opts: ActivityTrackerOptions = {}) {
    this.inputThrottleMs = opts.inputThrottleMs ?? 1000;
    this.actor = createActor(activityMachine, {
      input: { idleAfterMs: opts.idleAfterMs },
    });

    // The chart starts in `active` (see machine `initial`).
    this.state = createReactive<ActivityState>({ status: "active" });

    // A single dispatch per chart emit: time the state we're leaving, update
    // the reactive `status`, and fan the transition out as an event.
    const advance = (toState: ActivityStatus) => {
      const at = Date.now();
      const fromState = this.state.status;
      const durationMs = at - this.enteredAt;
      this.state.status = toState;
      this.enteredAt = at;
      this.dispatch({ fromState, toState, at, durationMs });
    };
    const subs = [
      this.actor.on("active", () => advance("active")),
      this.actor.on("idle", () => advance("idle")),
      this.actor.on("hidden", () => advance("hidden")),
    ];
    this.detachers.push(() => {
      for (const s of subs) s.unsubscribe();
    });

    this.actor.start();
  }

  private dispatch(event: ActivityEvent): void {
    const set = this.listeners.get(event.toState);
    if (!set) return;
    // Deleting the current handler mid-iteration (self-unsubscribe) is safe
    // per the Set iterator spec, so no snapshot is needed.
    for (const handler of set) handler(event);
  }

  /** Subscribe to transitions *into* `toState` (see {@link ActivityEvent}) —
   *  the push counterpart to `state`. Fires once per transition; use it for
   *  fire-and-forget consumers like analytics. Returns an unsubscribe fn. */
  on(toState: ActivityStatus, handler: ActivityEventHandler): () => void {
    const set = this.listeners.get(toState) ?? new Set<ActivityEventHandler>();
    this.listeners.set(toState, set);
    set.add(handler);
    const detach = () => {
      set.delete(handler);
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
