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
  it("starts active and not long-idle", () => {
    const tracker = new ActivityTracker();
    expect(tracker.state.status).toBe("active");
    expect(tracker.state.longIdle).toBe(false);
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

  it("flips longIdle at the long threshold without changing status", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000, longIdleAfterMs: 5000 });
    const longIdleSeen: boolean[] = [];
    const dispose = effect(() => {
      longIdleSeen.push(tracker.state.longIdle);
    });

    vi.advanceTimersByTime(1001); // → idle.recent: status "idle", longIdle still false
    expect(tracker.state.status).toBe("idle");
    expect(tracker.state.longIdle).toBe(false);

    vi.advanceTimersByTime(5000); // → idle.long
    expect(tracker.state.status).toBe("idle"); // coarse status unchanged
    expect(tracker.state.longIdle).toBe(true); // long signal flipped
    expect(longIdleSeen).toEqual([false, true]); // effect saw exactly one change

    dispose();
    tracker.destroy();
  });
});
