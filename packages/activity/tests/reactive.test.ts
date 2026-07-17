import { effect } from "@supergrain/kernel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityTracker, type ActivityStatus } from "../src/activity-tracker";

/**
 * `tracker.state` is the tracker's whole read surface: an ordinary
 * @supergrain/kernel reactive object, so reading its fields inside `effect`
 * re-runs on chart transitions. The XState chart stays internal. Driven by
 * fake timers (no DOM).
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityTracker.state", () => {
  it("starts active", () => {
    const tracker = new ActivityTracker();
    expect(tracker.state.status).toBe("active");
    tracker.destroy();
  });

  it("re-runs an effect when status transitions", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });
    const seen: ActivityStatus[] = [];
    const dispose = effect(() => {
      seen.push(tracker.state.status);
    });

    expect(seen).toEqual(["active"]); // effect runs once immediately
    vi.advanceTimersByTime(1001); // active → idle
    expect(seen).toEqual(["active", "idle"]);

    dispose();
    tracker.destroy();
  });

  it("currentDurationMs reports time in the current state", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });

    vi.advanceTimersByTime(500); // still active
    expect(tracker.currentDurationMs()).toBe(500);

    vi.advanceTimersByTime(500); // → idle at 1000ms
    vi.advanceTimersByTime(300); // 300ms into idle
    expect(tracker.state.status).toBe("idle");
    expect(tracker.currentDurationMs()).toBe(300);

    tracker.destroy();
  });
});
