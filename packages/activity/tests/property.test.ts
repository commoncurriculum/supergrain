// Model-based property coverage for the activity chart end to end: DOM event →
// `dom-bridge` → XState chart → `ActivityTracker.state` / `on(...)`.
//
// The unit tests walk specific paths through the chart. This drives arbitrary
// interleavings of the three inputs and the idle clock against an independent
// reference machine, so any path that disagrees — not just the ones someone
// thought to write down — shows up as a counterexample.

import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityTracker, type ActivityEvent, type ActivityStatus } from "../src/activity-tracker";
import { asDocument, FakeDocument } from "./helpers";

const IDLE_AFTER_MS = 1000;

type Step =
  | { kind: "input" }
  | { kind: "focus" }
  | { kind: "blur" }
  | { kind: "advance"; ms: number };

const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  fc.constant<Step>({ kind: "input" }),
  fc.constant<Step>({ kind: "focus" }),
  fc.constant<Step>({ kind: "blur" }),
  // Boundary values around IDLE_AFTER_MS are the interesting ones.
  fc.record({
    kind: fc.constant<"advance">("advance"),
    ms: fc.constantFrom(1, 100, 499, 500, 999, 1000, 1001, 2500),
  }),
);

/**
 * Independent reference for the chart in `machines/activity.ts`:
 *
 *   active — USER_INPUT restarts the idle timer; BLUR → hidden; FOCUS ignored
 *   idle   — USER_INPUT / FOCUS → active; BLUR → hidden
 *   hidden — FOCUS → active; USER_INPUT and BLUR ignored
 */
class ReferenceMachine {
  status: ActivityStatus = "active";
  /** ms spent in `active` since it was (re)entered; only meaningful there. */
  private activeElapsed = 0;

  input(): void {
    if (this.status === "active" || this.status === "idle") this.enterActive();
  }

  focus(): void {
    if (this.status !== "active") this.enterActive();
  }

  blur(): void {
    if (this.status !== "hidden") this.status = "hidden";
  }

  advance(ms: number): void {
    if (this.status !== "active") return;
    if (this.activeElapsed + ms >= IDLE_AFTER_MS) this.status = "idle";
    else this.activeElapsed += ms;
  }

  private enterActive(): void {
    this.status = "active";
    this.activeElapsed = 0;
  }
}

/** Apply one step to both the real tracker (via the DOM) and the reference. */
function drive(doc: FakeDocument, model: ReferenceMachine, step: Step): void {
  switch (step.kind) {
    case "input": {
      doc.dispatch("keydown");
      model.input();
      return;
    }
    case "focus": {
      doc.hidden = false;
      doc.dispatch("visibilitychange");
      model.focus();
      return;
    }
    case "blur": {
      doc.hidden = true;
      doc.dispatch("visibilitychange");
      model.blur();
      return;
    }
    case "advance": {
      vi.advanceTimersByTime(step.ms);
      model.advance(step.ms);
      return;
    }
  }
}

interface Env {
  tracker: ActivityTracker;
  doc: FakeDocument;
  model: ReferenceMachine;
  detach: () => void;
}

/**
 * A tracker attached to `doc`. The document has no `defaultView`, so focus and
 * blur arrive through `visibilitychange`, keeping one input path per step kind.
 */
function setup(doc = new FakeDocument(null)): Env {
  const tracker = new ActivityTracker({ idleAfterMs: IDLE_AFTER_MS, inputThrottleMs: 0 });
  const detach = tracker.attachDOM(asDocument(doc));
  return { tracker, doc, model: new ReferenceMachine(), detach };
}

/** Run `fn` against a fresh tracker, destroying it afterwards. */
function withTracker(fn: (env: Env) => void, doc?: FakeDocument): void {
  const env = setup(doc);
  try {
    fn(env);
  } finally {
    env.tracker.destroy();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const sequenceArbitrary = fc.array(stepArbitrary, { maxLength: 30 });

describe("ActivityTracker — matches the reference machine", () => {
  it("status agrees with the reference after every step", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (steps) =>
        withTracker(({ tracker, doc, model }) => {
          expect(tracker.state.status).toBe(model.status);
          for (const step of steps) {
            drive(doc, model, step);
            expect(tracker.state.status).toBe(model.status);
          }
        }),
      ),
      { numRuns: 300 },
    );
  });

  it("status is always one of the three chart states", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (steps) =>
        withTracker(({ tracker, doc, model }) => {
          for (const step of steps) {
            drive(doc, model, step);
            expect(["active", "idle", "hidden"]).toContain(tracker.state.status);
          }
        }),
      ),
      { numRuns: 200 },
    );
  });
});

describe("ActivityTracker — transition events", () => {
  it("every delivered event is a genuine change, and matches the new status", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (steps) =>
        withTracker(({ tracker, doc, model }) => {
          const seen: Array<ActivityEvent> = [];
          for (const status of ["active", "idle", "hidden"] as const) {
            tracker.on(status, (event) => {
              // The reactive projection must already reflect the transition by
              // the time listeners run — `state` and `on` can't disagree.
              expect(tracker.state.status).toBe(status);
              seen.push(event);
            });
          }

          for (const step of steps) drive(doc, model, step);

          for (const event of seen) {
            expect(event.fromState).not.toBe(event.toState);
            expect(event.durationMs).toBeGreaterThanOrEqual(0);
          }
          // The chain is contiguous: each event leaves where the next begins.
          for (let i = 1; i < seen.length; i++) {
            expect(seen[i]!.fromState).toBe(seen[i - 1]!.toState);
          }
          if (seen.length > 0) {
            expect(seen[0]!.fromState).toBe("active"); // the chart's initial state
            expect(seen[seen.length - 1]!.toState).toBe(tracker.state.status);
          }
        }),
      ),
      { numRuns: 300 },
    );
  });

  it("reported durations tile the elapsed time exactly", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (steps) =>
        withTracker(({ tracker, doc, model }) => {
          const seen: Array<ActivityEvent> = [];
          for (const status of ["active", "idle", "hidden"] as const) {
            tracker.on(status, (event) => seen.push(event));
          }

          const startedAt = Date.now();
          for (const step of steps) drive(doc, model, step);

          const total = seen.reduce((sum, event) => sum + event.durationMs, 0);
          expect(total + tracker.currentDurationMs()).toBe(Date.now() - startedAt);
        }),
      ),
      { numRuns: 300 },
    );
  });

  it("an unsubscribed handler never fires again", () => {
    fc.assert(
      fc.property(sequenceArbitrary, fc.nat(), (steps, cut) =>
        withTracker(({ tracker, doc, model }) => {
          let calls = 0;
          const off = tracker.on("idle", () => {
            calls++;
          });

          const splitAt = steps.length === 0 ? 0 : cut % (steps.length + 1);
          for (const step of steps.slice(0, splitAt)) drive(doc, model, step);
          off();
          const afterUnsubscribe = calls;
          for (const step of steps.slice(splitAt)) drive(doc, model, step);

          expect(calls).toBe(afterUnsubscribe);
        }),
      ),
      { numRuns: 300 },
    );
  });

  it("no events are delivered after destroy()", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (steps) => {
        const { tracker, doc, model } = setup();
        let calls = 0;
        for (const status of ["active", "idle", "hidden"] as const) {
          tracker.on(status, () => {
            calls++;
          });
        }

        tracker.destroy();
        const afterDestroy = calls;
        for (const step of steps) drive(doc, model, step);

        expect(calls).toBe(afterDestroy);
      }),
      { numRuns: 200 },
    );
  });
});

describe("ActivityTracker — attachDOM seeding", () => {
  it.each([
    { hidden: false, focused: true, expected: "active" },
    { hidden: false, focused: false, expected: "hidden" },
    { hidden: true, focused: true, expected: "hidden" },
    { hidden: true, focused: false, expected: "hidden" },
  ] as const)(
    "hidden=$hidden, focused=$focused starts $expected",
    ({ hidden, focused, expected }) => {
      const doc = new FakeDocument(null);
      doc.hidden = hidden;
      doc.focused = focused;
      withTracker(({ tracker }) => {
        expect(tracker.state.status).toBe(expected);
      }, doc);
    },
  );

  it("attachDOM is idempotent — the second call returns the same detach", () => {
    withTracker(({ tracker, doc, detach }) => {
      expect(tracker.attachDOM(asDocument(doc))).toBe(detach);
    });
  });
});
