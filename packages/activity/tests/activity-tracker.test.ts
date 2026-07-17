import type { ActivityEmitted } from "../src/machines/activity";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityTracker } from "../src/activity-tracker";

/**
 * ActivityTracker class-level tests, focused on the richer event API
 * (`on` / `onEvent`) that analytics consumes. Transitions are driven by
 * fake timers alone (no DOM), so these exercise the tracker wrapper, not
 * the DOM bridge (covered in dom-bridge.test.ts).
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityTracker — on() typed single-event subscription", () => {
  it("fires the idle handler once when the idle threshold elapses", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1_000 });
    const idle = vi.fn();
    tracker.on("idle", idle);

    vi.advanceTimersByTime(1_001);
    expect(idle).toHaveBeenCalledTimes(1);
    tracker.destroy();
  });

  it("surfaces longIdle — the threshold subscribe() collapses away", () => {
    const tracker = new ActivityTracker({
      idleAfterMs: 1_000,
      longIdleAfterMs: 5_000,
    });
    const longIdle = vi.fn();
    tracker.on("longIdle", longIdle);

    vi.advanceTimersByTime(1_001); // → idle.recent
    expect(longIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000); // → idle.long
    expect(longIdle).toHaveBeenCalledTimes(1);
    tracker.destroy();
  });

  it("unsubscribe returned by on() stops further delivery", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1_000 });
    const idle = vi.fn();
    const off = tracker.on("idle", idle);
    off();

    vi.advanceTimersByTime(1_001);
    expect(idle).not.toHaveBeenCalled();
    tracker.destroy();
  });
});

describe("ActivityTracker — onEvent() whole-stream subscription", () => {
  it("receives the transition events in order", () => {
    const tracker = new ActivityTracker({
      idleAfterMs: 1_000,
      longIdleAfterMs: 5_000,
    });
    const events: ActivityEmitted["type"][] = [];
    tracker.onEvent((e) => events.push(e.type));

    vi.advanceTimersByTime(1_001); // active → idle
    vi.advanceTimersByTime(5_000); // idle.recent → idle.long (longIdle)

    // `active` was emitted on the initial entry before we subscribed, so the
    // captured stream starts at the first post-subscription transition.
    expect(events).toEqual(["idle", "longIdle"]);
    tracker.destroy();
  });

  it("destroy() detaches every onEvent/on subscription", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1_000 });
    const seen = vi.fn();
    tracker.onEvent(seen);
    tracker.destroy();

    vi.advanceTimersByTime(10_000);
    expect(seen).not.toHaveBeenCalled();
  });
});
