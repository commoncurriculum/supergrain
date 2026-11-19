import { setup, emit } from "xstate";

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
