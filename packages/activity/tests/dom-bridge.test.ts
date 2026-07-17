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

describe("ActivityTracker — DOM-driven state", () => {
  it("reflects input / idle transitions in state.status", () => {
    const tracker = new ActivityTracker({
      idleAfterMs: 15_000,
      inputThrottleMs: 1_000,
    });
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));
    expect(tracker.state.status).toBe("active");

    // Repeated input keeps resetting the idle timer → stays active
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(2_000);
      fake.dispatch("keydown");
    }
    expect(tracker.state.status).toBe("active");

    vi.advanceTimersByTime(15_000); // no input → idle
    expect(tracker.state.status).toBe("idle");

    fake.dispatch("keydown"); // → active again
    expect(tracker.state.status).toBe("active");

    tracker.destroy();
  });

  it("longIdle flips only at the LONG threshold — a short idle never does", () => {
    const tracker = new ActivityTracker({
      idleAfterMs: 1_000,
      longIdleAfterMs: 3_000,
      inputThrottleMs: 100,
    });
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));

    // Short idle: observable status, NOT the long signal
    vi.advanceTimersByTime(1_000);
    expect(tracker.state.status).toBe("idle");
    expect(tracker.state.longIdle).toBe(false);

    // Long idle: the disconnect-safe signal flips
    vi.advanceTimersByTime(3_000);
    expect(tracker.state.longIdle).toBe(true);

    // Input clears it
    fake.dispatch("keydown");
    expect(tracker.state.status).toBe("active");
    expect(tracker.state.longIdle).toBe(false);

    tracker.destroy();
  });

  it("a hidden tab going dormant sets status hidden and longIdle", () => {
    const tracker = new ActivityTracker({ longBlurMs: 1_000, longIdleAfterMs: 3_000 });
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));

    fake.hidden = true;
    fake.dispatch("visibilitychange"); // → hidden
    expect(tracker.state.status).toBe("hidden");
    expect(tracker.state.longIdle).toBe(false);

    vi.advanceTimersByTime(3_000); // → hidden.dormant
    expect(tracker.state.status).toBe("hidden");
    expect(tracker.state.longIdle).toBe(true);

    tracker.destroy();
  });
});
