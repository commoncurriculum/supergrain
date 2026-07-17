import type { activityMachine } from "../src/machines/activity";
import type { ActorRefFromLogic } from "xstate";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityTracker } from "../src/activity-tracker";
import { attachActivityListeners } from "../src/dom-bridge";

/**
 * Minimal stand-in for Document: addEventListener / removeEventListener /
 * hidden, plus a dispatch helper. Enough for the bridge, which only uses
 * those three members.
 */
class FakeDocument {
  hidden = false;
  private handlers = new Map<string, Set<() => void>>();

  addEventListener(event: string, handler: () => void): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  removeEventListener(event: string, handler: () => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  dispatch(event: string): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler();
  }

  handlerCount(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}

const asDocument = (fake: FakeDocument) => fake as unknown as Document;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("attachActivityListeners — event mapping", () => {
  function spyActor() {
    const send = vi.fn();
    return {
      actor: { send } as unknown as ActorRefFromLogic<typeof activityMachine>,
      send,
    };
  }

  it("maps user-input, focus, and blur events to machine events", () => {
    const { actor, send } = spyActor();
    const fake = new FakeDocument();
    attachActivityListeners(actor, asDocument(fake));

    fake.dispatch("keydown");
    expect(send).toHaveBeenLastCalledWith({ type: "USER_INPUT" });
    fake.dispatch("focus");
    expect(send).toHaveBeenLastCalledWith({ type: "FOCUS" });
    fake.dispatch("blur");
    expect(send).toHaveBeenLastCalledWith({ type: "BLUR" });
  });

  it("maps visibilitychange by document.hidden", () => {
    const { actor, send } = spyActor();
    const fake = new FakeDocument();
    attachActivityListeners(actor, asDocument(fake));

    fake.hidden = true;
    fake.dispatch("visibilitychange");
    expect(send).toHaveBeenLastCalledWith({ type: "BLUR" });
    fake.hidden = false;
    fake.dispatch("visibilitychange");
    expect(send).toHaveBeenLastCalledWith({ type: "FOCUS" });
  });

  it("throttles USER_INPUT to one machine event per inputThrottleMs", () => {
    const { actor, send } = spyActor();
    const fake = new FakeDocument();
    attachActivityListeners(actor, asDocument(fake), {
      inputThrottleMs: 1_000,
    });

    // A burst of high-frequency input → exactly one USER_INPUT
    for (let i = 0; i < 50; i++) fake.dispatch("mousemove");
    expect(send).toHaveBeenCalledTimes(1);

    // Still inside the window → nothing new
    vi.advanceTimersByTime(999);
    fake.dispatch("mousemove");
    expect(send).toHaveBeenCalledTimes(1);

    // Window elapsed → next input goes through
    vi.advanceTimersByTime(1);
    fake.dispatch("mousemove");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not throttle FOCUS/BLUR", () => {
    const { actor, send } = spyActor();
    const fake = new FakeDocument();
    attachActivityListeners(actor, asDocument(fake), {
      inputThrottleMs: 1_000,
    });
    fake.dispatch("blur");
    fake.dispatch("focus");
    fake.dispatch("blur");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("attachDOM is idempotent — repeated calls reuse the first detach", () => {
    const tracker = new ActivityTracker();
    const fake = new FakeDocument();
    const first = tracker.attachDOM(asDocument(fake));
    const listeners = fake.handlerCount();
    const second = tracker.attachDOM(asDocument(fake));
    expect(second).toBe(first); // same detach fn, no second registration
    expect(fake.handlerCount()).toBe(listeners);
    tracker.destroy();
  });

  it("cleanup removes every listener", () => {
    const { actor, send } = spyActor();
    const fake = new FakeDocument();
    const detach = attachActivityListeners(actor, asDocument(fake));
    expect(fake.handlerCount()).toBeGreaterThan(0);
    detach();
    expect(fake.handlerCount()).toBe(0);
    fake.dispatch("keydown");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("ActivityTracker — subscribe dedup", () => {
  it("only notifies on actual state changes, not per input event", () => {
    const tracker = new ActivityTracker({
      idleAfterMs: 15_000,
      inputThrottleMs: 1_000,
    });
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));

    const states: string[] = [];
    tracker.subscribe((s) => states.push(s));
    expect(states).toEqual(["active"]); // immediate current state

    // Repeated input while already active → re-entries are deduplicated
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(2_000);
      fake.dispatch("keydown");
    }
    expect(states).toEqual(["active"]);
    expect(tracker.state).toBe("active");

    vi.advanceTimersByTime(15_000); // no input → idle
    expect(states).toEqual(["active", "idle"]);

    fake.dispatch("keydown"); // → active again, exactly one notification
    expect(states).toEqual(["active", "idle", "active"]);

    tracker.destroy();
  });

  it("attachTo pauses on LONG idle only — a short pause never disconnects", () => {
    const tracker = new ActivityTracker({
      idleAfterMs: 1_000,
      longIdleAfterMs: 3_000,
      inputThrottleMs: 100,
    });
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));
    const sink = { notifyIdle: vi.fn(), notifyActive: vi.fn() };
    tracker.attachTo(sink);

    // Short idle (the 15s-equivalent threshold): observable, NOT a teardown
    vi.advanceTimersByTime(1_000);
    expect(tracker.state).toBe("idle");
    expect(sink.notifyIdle).not.toHaveBeenCalled();

    // Long idle (the 15min-equivalent threshold): now pause the connection
    vi.advanceTimersByTime(3_000);
    expect(sink.notifyIdle).toHaveBeenCalledTimes(1);

    // Input wakes the sink back up
    fake.dispatch("keydown");
    expect(sink.notifyActive).toHaveBeenCalledTimes(1);

    tracker.destroy();
  });
});
