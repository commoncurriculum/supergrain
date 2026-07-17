import { batch, createReactive } from "@supergrain/kernel";
import { createActor, type ActorRefFromLogic } from "xstate";

import { attachActivityListeners } from "./dom-bridge";
import { activityMachine, ACTIVITY_EVENT_TYPES, type ActivityEmitted } from "./machines/activity";

/**
 * ActivityTracker — wraps the ActivityMachine state chart and projects it
 * outward as a reactive @supergrain/kernel object.
 *
 * The chart stays internal: XState owns the verified transitions (the
 * debounce, focus/visibility, and double-fire edge cases live as chart
 * states, not hand-rolled timers). The rest of the app never touches
 * XState — it reads `tracker.reactive`, an ordinary reactive object, inside
 * an `effect` / `computed` like any other Supergrain state:
 *
 *   const activity = new ActivityTracker();
 *   activity.attachDOM();
 *   effect(() => console.log(activity.reactive.state));   // re-runs on change
 *
 * Activity is intentionally separate from Connection: it's about the user's
 * behavior on this tab, not the link to the server. The one optional
 * integration (`attachTo`) wires the machine's LONG-idle signal (default
 * 15 min, not the 15 s idle signal) into a connection for idle-disconnect.
 * Short idle is an observable state, never a teardown trigger.
 */

export type ActivityState = "active" | "idle" | "hidden";

/** Reactive projection of the state chart. Read these inside an `effect` or
 *  `computed`; they update when the underlying chart transitions. */
export interface ActivityReactive {
  /** Coarse activity state. Substates (idle.recent/long, hidden.*) collapse
   *  to these three — use `longIdle` for the long-threshold signal. */
  state: ActivityState;
  /** True once the user has been gone for `longIdleAfterMs` (chart is in
   *  `idle.long` or `hidden.dormant`) — the signal `state` alone can't
   *  express, and the safe trigger for idle-disconnect. */
  longIdle: boolean;
}

export interface ActivityTrackerOptions {
  idleAfterMs?: number | undefined;
  /** How long the user must be idle/hidden before `attachTo` pauses the
   *  connection. Default 900_000 (15 min). */
  longIdleAfterMs?: number | undefined;
  longBlurMs?: number | undefined;
  /** Min ms between USER_INPUT events forwarded from the DOM bridge.
   *  Default 1000. */
  inputThrottleMs?: number | undefined;
}

/** Anything with notifyIdle / notifyActive — Connection satisfies this. */
export interface IdleSink {
  notifyIdle(): void;
  notifyActive(): void;
}

function toPublicState(value: unknown): ActivityState {
  if (typeof value === "string") return value as ActivityState;
  const [key] = Object.keys(value as Record<string, unknown>);
  /* c8 ignore next -- a chart value is a string or a non-empty object, so key is always present */
  return (key ?? "active") as ActivityState;
}

/** The chart's two long-threshold substates, which `toPublicState` collapses
 *  away: `idle.long` and `hidden.dormant`. */
function isLongIdle(value: unknown): boolean {
  if (typeof value === "string") return false;
  const v = value as Record<string, string | undefined>;
  return v["idle"] === "long" || v["hidden"] === "dormant";
}

export class ActivityTracker {
  private actor: ActorRefFromLogic<typeof activityMachine>;
  private domDetach: (() => void) | null = null;
  private detachers: Array<() => void> = [];
  private inputThrottleMs: number;
  private readonly store: ActivityReactive;

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
    this.store = createReactive<ActivityReactive>({
      state: toPublicState(snapshot.value),
      longIdle: isLongIdle(snapshot.value),
    });

    // The actor drives the reactive projection: every chart transition
    // writes the derived values into the store (batched, and only on change
    // so equal transitions don't churn subscribers).
    const sub = this.actor.subscribe((snap) => {
      const state = toPublicState(snap.value);
      const longIdle = isLongIdle(snap.value);
      batch(() => {
        if (this.store.state !== state) this.store.state = state;
        if (this.store.longIdle !== longIdle) this.store.longIdle = longIdle;
      });
    });
    this.detachers.push(() => sub.unsubscribe());

    this.actor.start();
  }

  /** The reactive projection of the chart. Read `.state` / `.longIdle`
   *  inside an `effect` or `computed` — this is the intended interface to
   *  the rest of the app. */
  get reactive(): Readonly<ActivityReactive> {
    return this.store;
  }

  /** Wire long-idle/active emissions into a Connection (or anything with
   *  notifyIdle/notifyActive) so it auto-pauses when the user has been
   *  gone for `longIdleAfterMs` — NOT at the 15 s idle threshold. */
  attachTo(sink: IdleSink): () => void {
    const a = this.actor.on("active", () => sink.notifyActive());
    const i = this.actor.on("longIdle", () => sink.notifyIdle());
    const detach = () => {
      a.unsubscribe();
      i.unsubscribe();
    };
    this.detachers.push(detach);
    return detach;
  }

  /** Attach DOM listeners (focus / blur / visibilitychange / 10 user events). */
  attachDOM(target: Document = document): () => void {
    if (this.domDetach) return this.domDetach;
    this.domDetach = attachActivityListeners(this.actor, target, {
      inputThrottleMs: this.inputThrottleMs,
    });
    return this.domDetach;
  }

  /** Push-style subscription to the coarse state, for consumers outside a
   *  reactive context. Fires immediately with the current state, then only
   *  when the value actually changes (re-entries of `active` and substate
   *  shifts like idle.recent → idle.long are deduplicated). Prefer
   *  `reactive` inside `effect`/`computed`. */
  subscribe(callback: (state: ActivityState) => void): () => void {
    let last = this.state;
    callback(last);
    const sub = this.actor.subscribe((snap) => {
      const value = toPublicState(snap.value);
      if (value === last) return;
      last = value;
      callback(value);
    });
    return () => sub.unsubscribe();
  }

  /** Subscribe to a single emitted event by name, with its typed payload.
   *  Unlike the reactive projection, these are the machine's raw emissions
   *  and are NOT collapsed — this is the surface analytics wants: the long
   *  thresholds and the blur duration (`longBlurReturn`).
   *
   *  Note: `active` re-fires on every re-entry (i.e. per forwarded
   *  USER_INPUT, already throttled by the DOM bridge). The transition
   *  events (`idle`, `longIdle`, `hidden`, `longBlurReturn`) each fire once
   *  per entry. Returns an unsubscribe function. */
  on<T extends ActivityEmitted["type"]>(
    type: T,
    handler: (event: Extract<ActivityEmitted, { type: T }>) => void,
  ): () => void {
    const sub = this.actor.on(type, handler as (e: ActivityEmitted) => void);
    const detach = () => sub.unsubscribe();
    this.detachers.push(detach);
    return detach;
  }

  /** Subscribe to the entire emitted event stream (active / idle / longIdle
   *  / hidden / longBlurReturn). Convenience over calling `on` for each
   *  name — intended for feeding an analytics sink. Returns an unsubscribe
   *  function. See `on` for the `active` re-entry caveat. */
  onEvent(handler: (event: ActivityEmitted) => void): () => void {
    const subs = ACTIVITY_EVENT_TYPES.map((type) => this.actor.on(type, handler));
    const detach = () => {
      for (const s of subs) s.unsubscribe();
    };
    this.detachers.push(detach);
    return detach;
  }

  /** Current coarse state, read imperatively (non-reactive). */
  get state(): ActivityState {
    return toPublicState(this.actor.getSnapshot().value);
  }

  destroy(): void {
    this.domDetach?.();
    this.domDetach = null;
    for (const d of this.detachers) d();
    this.detachers = [];
    this.actor.stop();
  }
}
