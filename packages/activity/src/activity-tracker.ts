import { createReactive } from "@supergrain/kernel";
import { createActor, type ActorRefFromLogic } from "xstate";

import { attachActivityListeners } from "./dom-bridge";
import { activityMachine } from "./machines/activity";

export type ActivityStatus = "active" | "idle" | "hidden";

/** Reactive activity state. Read `status` inside an `effect` / `computed`. */
export interface ActivityState {
  /** Coarse activity: the current chart state. */
  status: ActivityStatus;
}

/** An activity transition, delivered to `on(toState, …)` listeners. */
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

/**
 * Tracks whether the user is `active`, `idle`, or `hidden`.
 *
 * @example
 * ```ts
 * const activity = new ActivityTracker();
 * activity.attachDOM();
 * effect(() => console.log(activity.state.status));
 * activity.on("active", (e) => {
 *   if (e.fromState === "hidden" && e.durationMs > 120_000) track("resumed");
 * });
 * ```
 */
export class ActivityTracker {
  /** Reactive state; read `state.status` inside `effect` / `computed`. */
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

    // Must match the machine's `initial` state.
    this.state = createReactive<ActivityState>({ status: "active" });

    // The chart re-enters `active` on every input to reset the idle timer;
    // that is not a transition, so it must not reset the clock or emit.
    const advance = (toState: ActivityStatus) => {
      const fromState = this.state.status;
      if (toState === fromState) return;
      const at = Date.now();
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
    // Set iteration tolerates deleting the current entry (self-unsubscribe).
    for (const handler of set) handler(event);
  }

  /** Ms spent in the current `status` so far. Continued input does not
   *  restart it. */
  currentDurationMs(): number {
    return Date.now() - this.enteredAt;
  }

  /** Subscribe to transitions *into* `toState`. Returns an unsubscribe fn. */
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

  /** Attach DOM listeners that drive the tracker. A hidden tab or unfocused
   *  window starts `hidden`. Idempotent; returns a detach function. Throws
   *  if no `target` is passed and there is no global `document`. */
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
