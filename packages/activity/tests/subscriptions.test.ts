// Subscription bookkeeping for `ActivityTracker.on()` / `destroy()`.
//
// The behavioural half (an unsubscribed handler stops firing) was already true.
// What these add is the *retention* half: a tracker outlives many subscribers,
// so anything it keeps per `on()` call has to go when that subscription does,
// or a long-lived tracker accumulates dead handlers for its whole life.

import { effect } from "@supergrain/kernel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityTracker, type ActivityStatus } from "../src/activity-tracker";

/** The tracker's internal subscriber registry, for retention assertions. */
type TrackerInternals = {
  listeners: Map<ActivityStatus, Set<unknown>>;
  detachers?: Array<unknown>;
};

const internals = (tracker: ActivityTracker): TrackerInternals =>
  tracker as unknown as TrackerInternals;

/** Total handlers the tracker is still holding, across all states. */
function retainedHandlers(tracker: ActivityTracker): number {
  let total = 0;
  for (const set of internals(tracker).listeners.values()) total += set.size;
  // OLD-IMPL PROBE: per-handler closures the tracker never released.
  const extra = internals(tracker).detachers;
  if (extra) total += Math.max(0, extra.length - 1);
  return total;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityTracker.on — retention", () => {
  it("retains nothing once a subscription is disposed", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });

    const off = tracker.on("idle", () => {});
    expect(retainedHandlers(tracker)).toBe(1);

    off();

    expect(retainedHandlers(tracker)).toBe(0);
    tracker.destroy();
  });

  it("does not accumulate across many subscribe/unsubscribe cycles", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });

    for (let i = 0; i < 500; i++) {
      const off = tracker.on("active", () => {});
      off();
    }

    // A tracker that recorded each subscription separately would be holding 500
    // dead closures here, each pinning its handler.
    expect(retainedHandlers(tracker)).toBe(0);
    tracker.destroy();
  });

  it("keeps the live subscriptions while dropping the disposed ones", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });

    const offA = tracker.on("idle", () => {});
    tracker.on("idle", () => {});
    const offC = tracker.on("hidden", () => {});
    expect(retainedHandlers(tracker)).toBe(3);

    offA();
    offC();

    expect(retainedHandlers(tracker)).toBe(1);
    tracker.destroy();
  });

  it("disposing twice is harmless and does not disturb other subscribers", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });
    const kept = vi.fn();

    const off = tracker.on("idle", () => {});
    tracker.on("idle", kept);
    off();
    off();

    expect(retainedHandlers(tracker)).toBe(1);
    vi.advanceTimersByTime(1001); // active → idle
    expect(kept).toHaveBeenCalledTimes(1);
    tracker.destroy();
  });

  it("an unsubscribed handler stops firing, while its siblings keep firing", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });
    const dropped = vi.fn();
    const kept = vi.fn();

    const off = tracker.on("idle", dropped);
    tracker.on("idle", kept);
    off();

    vi.advanceTimersByTime(1001); // active → idle

    expect(dropped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
    tracker.destroy();
  });
});

describe("ActivityTracker.destroy — teardown", () => {
  it("releases every subscriber", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });
    tracker.on("idle", () => {});
    tracker.on("hidden", () => {});
    tracker.on("active", () => {});
    expect(retainedHandlers(tracker)).toBe(3);

    tracker.destroy();

    expect(retainedHandlers(tracker)).toBe(0);
  });

  it("delivers no further events, and the reactive status stops advancing", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });
    const handler = vi.fn();
    tracker.on("idle", handler);
    const seen: Array<ActivityStatus> = [];
    const dispose = effect(() => {
      seen.push(tracker.state.status);
    });

    tracker.destroy();
    vi.advanceTimersByTime(5000);

    expect(handler).not.toHaveBeenCalled();
    expect(seen).toEqual(["active"]);
    dispose();
  });

  it("is idempotent", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1000 });
    tracker.on("idle", () => {});

    tracker.destroy();
    expect(() => tracker.destroy()).not.toThrow();
    expect(retainedHandlers(tracker)).toBe(0);
  });

  it("still detaches DOM listeners", () => {
    const removed: Array<string> = [];
    const doc = {
      hidden: false,
      defaultView: undefined,
      addEventListener: () => {},
      removeEventListener: (type: string) => removed.push(type),
      hasFocus: () => true,
    } as unknown as Document;

    const tracker = new ActivityTracker({ idleAfterMs: 1000 });
    tracker.attachDOM(doc);

    tracker.destroy();

    expect(removed).toContain("visibilitychange");
    expect(removed).toContain("keydown");
  });
});
