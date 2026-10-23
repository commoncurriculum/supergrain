import { setup, emit } from "xstate";

/**
 * ActivityMachine — tracks whether the user is active, idle, or away.
 *
 * Pure state, no DOM. A separate browser-side bridge maps DOM events
 * (focus/blur/visibilitychange + the 10 user-input events) to the three
 * inputs this machine accepts.
 *
 *   idleAfterMs (15s) — no input this long → `idle` (a presence signal).
 *
 * States
 *   active — user has produced input recently
 *   idle   — visible/focused but no input for `idleAfterMs`
 *   hidden — page is blurred or backgrounded
 *
 * Inputs (events sent to the machine)
 *   USER_INPUT — any user input event (keydown, mousemove, scroll, ...)
 *   FOCUS      — pageshow / focus / resume / visibilitychange→visible
 *   BLUR       — pagehide / blur / freeze / visibilitychange→hidden
 *
 * Outputs (events emitted on entering each state)
 *   active / idle / hidden
 *
 * "How long was the user away / idle" is not modelled here — the wrapper
 * times each state and reports it as `durationMs` on the transition event.
 */

export interface ActivityContext {
  idleAfterMs: number;
}

export type ActivityMachineEvent = { type: "USER_INPUT" } | { type: "FOCUS" } | { type: "BLUR" };

export type ActivityEmitted = { type: "active" } | { type: "idle" } | { type: "hidden" };

export interface ActivityInput {
  idleAfterMs?: number | undefined;
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
  },
}).createMachine({
  id: "activity",
  initial: "active",
  context: ({ input }) => ({
    idleAfterMs: input.idleAfterMs ?? 15_000,
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
      entry: emit({ type: "hidden" }),
      on: {
        FOCUS: { target: "active" },
      },
    },
  },
});
