import { setup, assign, emit } from "xstate";

/**
 * ActivityMachine — tracks whether the user is active, idle, or away.
 *
 * Pure state, no DOM. A separate browser-side bridge maps DOM events
 * (focus/blur/visibilitychange + the 10 user-input events) to the three
 * inputs this machine accepts.
 *
 * Two idle thresholds, both chart states (ported from socket.ts, which
 * kept them apart: isActive flips after 15s, but the socket only closes
 * after 15min):
 *
 *   idleAfterMs (15s)      — "the user stopped interacting"; a signal
 *                            for presence/analytics, NOT for teardown
 *   longIdleAfterMs (15m)  — "the user is gone"; emits longIdle, which
 *                            ActivityTracker.attachTo forwards to
 *                            Connection.notifyIdle to pause the socket
 *
 * States
 *   active         — user has produced input recently
 *   idle           — page is visible/focused but no input for `idleAfterMs`
 *     idle.recent  — under `longIdleAfterMs`
 *     idle.long    — over `longIdleAfterMs`; emits longIdle on entry
 *   hidden         — page is blurred or backgrounded
 *     hidden.recent  — under `longBlurMs`
 *     hidden.long    — over `longBlurMs`; FOCUS from here emits longBlurReturn
 *     hidden.dormant — over `longIdleAfterMs`; emits longIdle on entry;
 *                      FOCUS from here also emits longBlurReturn
 *
 * Inputs (events sent to the machine)
 *   USER_INPUT — any user input event (keydown, mousemove, scroll, ...)
 *   FOCUS      — pageshow / focus / resume / visibilitychange→visible
 *   BLUR       — pagehide / blur / freeze / visibilitychange→hidden
 *
 * Outputs (events emitted to subscribers)
 *   active             — entered active state
 *   idle               — entered idle state
 *   longIdle           — user gone for >= longIdleAfterMs (idle.long or
 *                        hidden.dormant); safe trigger for idle-disconnect
 *   hidden             — entered hidden state
 *   longBlurReturn     — returned from a hidden period >= longBlurMs
 */

export interface ActivityContext {
  enteredHiddenAt: number | null;
  idleAfterMs: number;
  longIdleAfterMs: number;
  longBlurMs: number;
}

export type ActivityEvent = { type: "USER_INPUT" } | { type: "FOCUS" } | { type: "BLUR" };

export type ActivityEmitted =
  | { type: "active" }
  | { type: "idle" }
  | { type: "longIdle" }
  | { type: "hidden" }
  | { type: "longBlurReturn"; blurDurationMs: number };

/** Every emitted event name, for consumers (e.g. analytics) that want to
 *  subscribe to the whole stream. Kept exhaustive by the assertion below:
 *  add a new ActivityEmitted variant without listing it here and the file
 *  stops compiling. */
export const ACTIVITY_EVENT_TYPES = [
  "active",
  "idle",
  "longIdle",
  "hidden",
  "longBlurReturn",
] as const satisfies ReadonlyArray<ActivityEmitted["type"]>;

// Compile-time exhaustiveness: if a new ActivityEmitted variant is added
// without listing it above, `Assert<false>` fails to resolve and this file
// stops compiling. Type-only — no runtime footprint.
type Assert<T extends true> = T;
type _AllEventTypesListed = Assert<
  ActivityEmitted["type"] extends (typeof ACTIVITY_EVENT_TYPES)[number] ? true : false
>;
export type { _AllEventTypesListed };

export interface ActivityInput {
  idleAfterMs?: number | undefined;
  longIdleAfterMs?: number | undefined;
  longBlurMs?: number | undefined;
}

export const activityMachine = setup({
  types: {
    context: {} as ActivityContext,
    events: {} as ActivityEvent,
    input: {} as ActivityInput,
    emitted: {} as ActivityEmitted,
  },
  delays: {
    IDLE_AFTER: ({ context }) => context.idleAfterMs,
    LONG_IDLE_AFTER: ({ context }) => context.longIdleAfterMs,
    LONG_BLUR_AFTER: ({ context }) => context.longBlurMs,
  },
  actions: {
    recordEnteredHidden: assign({
      enteredHiddenAt: () => Date.now(),
    }),
    emitLongBlurReturn: emit(({ context }) => ({
      type: "longBlurReturn" as const,
      blurDurationMs: Date.now() - (context.enteredHiddenAt ?? Date.now()),
    })),
  },
}).createMachine({
  id: "activity",
  initial: "active",
  context: ({ input }) => ({
    enteredHiddenAt: null,
    idleAfterMs: input.idleAfterMs ?? 15_000,
    longIdleAfterMs: input.longIdleAfterMs ?? 900_000,
    longBlurMs: input.longBlurMs ?? 120_000,
  }),
  states: {
    active: {
      entry: emit({ type: "active" }),
      after: {
        IDLE_AFTER: { target: "idle" },
      },
      on: {
        USER_INPUT: { target: "active", reenter: true },
        BLUR: { target: "hidden" },
      },
    },
    idle: {
      entry: emit({ type: "idle" }),
      initial: "recent",
      on: {
        USER_INPUT: { target: "active" },
        FOCUS: { target: "active" },
        BLUR: { target: "hidden" },
      },
      states: {
        recent: {
          after: {
            LONG_IDLE_AFTER: { target: "long" },
          },
        },
        long: {
          entry: emit({ type: "longIdle" }),
        },
      },
    },
    hidden: {
      entry: ["recordEnteredHidden", emit({ type: "hidden" })],
      initial: "recent",
      // Longer threshold than recent→long; timer spans substate changes.
      after: {
        LONG_IDLE_AFTER: { target: ".dormant" },
      },
      states: {
        recent: {
          after: {
            LONG_BLUR_AFTER: { target: "long" },
          },
          on: {
            FOCUS: { target: "#activity.active" },
          },
        },
        long: {
          on: {
            FOCUS: {
              target: "#activity.active",
              actions: "emitLongBlurReturn",
            },
          },
        },
        dormant: {
          entry: emit({ type: "longIdle" }),
          on: {
            FOCUS: {
              target: "#activity.active",
              actions: "emitLongBlurReturn",
            },
          },
        },
      },
    },
  },
});
