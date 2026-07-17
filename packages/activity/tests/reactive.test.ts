import { effect } from "@supergrain/kernel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityTracker, type ActivityState } from "../src/activity-tracker";

/**
 * The reactive projection is the intended interface to the rest of the app:
 * `tracker.reactive` is an ordinary @supergrain/kernel reactive object, so
 * reading it inside `effect` re-runs on chart transitions. The XState chart
 * stays internal. Driven by fake timers (no DOM).
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityTracker — reactive projection", () => {
  it("starts in active", () => {
    const tracker = new ActivityTracker();
    expect(tracker.reactive.state).toBe("active");
    expect(tracker.reactive.longIdle).toBe(false);
    tracker.destroy();
  });

  it("re-runs an effect when the coarse state transitions", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });
    const seen: ActivityState[] = [];
    const dispose = effect(() => {
      seen.push(tracker.reactive.state);
    });

    expect(seen).toEqual(["active"]); // effect runs once immediately
    vi.advanceTimersByTime(1001); // active → idle
    expect(seen).toEqual(["active", "idle"]);

    dispose();
    tracker.destroy();
  });

  it("flips reactive.longIdle at the long threshold, without a coarse-state change", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000, longIdleAfterMs: 5000 });
    const longIdleSeen: boolean[] = [];
    const dispose = effect(() => {
      longIdleSeen.push(tracker.reactive.longIdle);
    });

    vi.advanceTimersByTime(1001); // → idle.recent (state "idle", longIdle false)
    expect(tracker.reactive.state).toBe("idle");
    expect(tracker.reactive.longIdle).toBe(false);

    vi.advanceTimersByTime(5000); // → idle.long
    expect(tracker.reactive.state).toBe("idle"); // coarse state unchanged
    expect(tracker.reactive.longIdle).toBe(true); // but the long signal flipped
    expect(longIdleSeen).toEqual([false, true]);

    dispose();
    tracker.destroy();
  });

  it("clears longIdle when the user returns to active", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000, longIdleAfterMs: 5000 });
    vi.advanceTimersByTime(6001); // → idle.long
    expect(tracker.reactive.longIdle).toBe(true);

    tracker.destroy();
  });
});
