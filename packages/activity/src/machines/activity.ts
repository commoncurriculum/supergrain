import { setup, assign, emit } from "xstate";

/**
 * ActivityMachine — tracks whether the user is active, idle, or away.
 *
 * Pure state, no DOM. A separate browser-side bridge maps DOM events
 * (focus/blur/visibilitychange + the 10 user-input events) to the three
 * inputs this machine accepts.
 *
 *   idleAfterMs (15s) — no input this long → `idle` (a presence signal).
 *   longBlurMs (2m)   — a hidden period this long is a "real" absence, so
 *                       returning from it emits `longBlurReturn`.
 *
 * States
 *   active           — user has produced input recently
 *   idle             — visible/focused but no input for `idleAfterMs`
 *   hidden           — page is blurred or backgrounded
 *     hidden.recent  — under `longBlurMs`
 *     hidden.long    — over `longBlurMs`; FOCUS from here emits longBlurReturn
 *
 * Inputs (events sent to the machine)
 *   USER_INPUT — any user input event (keydown, mousemove, scroll, ...)
 *   FOCUS      — pageshow / focus / resume / visibilitychange→visible
 *   BLUR       — pagehide / blur / freeze / visibilitychange→hidden
 *
 * Outputs (events emitted to subscribers)
 *   active         — entered active state
 *   idle           — entered idle state
 *   hidden         — entered hidden state
 *   longBlurReturn — returned from a hidden period >= longBlurMs
 */

export interface ActivityContext {
  enteredHiddenAt: number | null;
  idleAfterMs: number;
  longBlurMs: number;
}

export type ActivityMachineEvent = { type: "USER_INPUT" } | { type: "FOCUS" } | { type: "BLUR" };

export type ActivityEmitted =
  | { type: "active" }
  | { type: "idle" }
  | { type: "hidden" }
  | { type: "longBlurReturn"; blurDurationMs: number };

export interface ActivityInput {
  idleAfterMs?: number | undefined;
  longBlurMs?: number | undefined;
}

export const activityMachine = setup({
  types: {
    context: {} as ActivityContext,
    events: {} as ActivityMachineEvent,
    input: {} as ActivityInput,
    emitted: {} as ActivityEmitted,
  },
  delays: {
    IDLE_AFTER: ({ context }) => context.idleAfterMs,
    LONG_BLUR_AFTER: ({ context }) => context.longBlurMs,
  },
  actions: {
    recordEnteredHidden: assign({
      enteredHiddenAt: () => Date.now(),
    }),
    emitLongBlurReturn: emit(({ context }) => ({
      type: "longBlurReturn" as const,
      /* c8 ignore next -- enteredHiddenAt is set on entering `hidden`, always before a FOCUS can emit this */
      blurDurationMs: Date.now() - (context.enteredHiddenAt ?? Date.now()),
    })),
  },
}).createMachine({
  id: "activity",
  initial: "active",
  context: ({ input }) => ({
    enteredHiddenAt: null,
    idleAfterMs: input.idleAfterMs ?? 15_000,
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
      on: {
        USER_INPUT: { target: "active" },
        FOCUS: { target: "active" },
        BLUR: { target: "hidden" },
      },
    },
    hidden: {
      entry: ["recordEnteredHidden", emit({ type: "hidden" })],
      initial: "recent",
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
      },
    },
  },
});
