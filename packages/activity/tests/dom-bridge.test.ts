import type { activityMachine } from "../src/machines/activity";
import type { ActorRefFromLogic } from "xstate";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityTracker, type ActivityEvent } from "../src/activity-tracker";
import { attachActivityListeners } from "../src/dom-bridge";

/**
 * In-memory EventTarget stand-ins. The bridge only uses addEventListener /
 * removeEventListener / (document) `hidden` / `defaultView`, so these model
 * exactly that, with a `dispatch` helper. Window-level events (focus/blur/
 * pageshow/pagehide) go on `defaultView`; the rest on the document.
 */
class FakeEventTarget {
  private handlers = new Map<string, Set<EventListener>>();

  addEventListener(event: string, handler: EventListener): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  removeEventListener(event: string, handler: EventListener): void {
    this.handlers.get(event)?.delete(handler);
  }

  dispatch(event: string): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler({ type: event } as Event);
  }

  handlerCount(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}

class FakeWindow extends FakeEventTarget {}

class FakeDocument extends FakeEventTarget {
  hidden = false;
  defaultView: FakeWindow | null;

  constructor(win: FakeWindow | null = new FakeWindow()) {
    super();
    this.defaultView = win;
  }
}

const asDocument = (fake: FakeDocument) => fake as unknown as Document;
const windowOf = (fake: FakeDocument) => fake.defaultView as FakeWindow;

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

  it("maps each event to a machine input on the target the browser uses", () => {
    const { actor, send } = spyActor();
    const fake = new FakeDocument();
    const win = windowOf(fake);
    attachActivityListeners(actor, asDocument(fake));

    fake.dispatch("keydown");
    expect(send).toHaveBeenLastCalledWith({ type: "USER_INPUT" });

    // Window-level focus/blur + page show/hide
    win.dispatch("focus");
    expect(send).toHaveBeenLastCalledWith({ type: "FOCUS" });
    win.dispatch("pageshow");
    expect(send).toHaveBeenLastCalledWith({ type: "FOCUS" });
    win.dispatch("blur");
    expect(send).toHaveBeenLastCalledWith({ type: "BLUR" });
    win.dispatch("pagehide");
    expect(send).toHaveBeenLastCalledWith({ type: "BLUR" });

    // Document-level page-lifecycle freeze/resume
    fake.dispatch("resume");
    expect(send).toHaveBeenLastCalledWith({ type: "FOCUS" });
    fake.dispatch("freeze");
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

  it("skips window listeners when the document has no defaultView", () => {
    const { actor, send } = spyActor();
    const fake = new FakeDocument(null); // detached document — no window
    const detach = attachActivityListeners(actor, asDocument(fake));

    fake.dispatch("keydown"); // document-level still works
    expect(send).toHaveBeenLastCalledWith({ type: "USER_INPUT" });
    fake.dispatch("resume");
    expect(send).toHaveBeenLastCalledWith({ type: "FOCUS" });

    detach();
    expect(fake.handlerCount()).toBe(0);
  });

  it("throttles USER_INPUT to one machine event per inputThrottleMs", () => {
    const { actor, send } = spyActor();
    const fake = new FakeDocument();
    attachActivityListeners(actor, asDocument(fake), { inputThrottleMs: 1_000 });

    for (let i = 0; i < 50; i++) fake.dispatch("mousemove");
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    fake.dispatch("mousemove");
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    fake.dispatch("mousemove");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("cleanup removes every listener, on document and window", () => {
    const { actor, send } = spyActor();
    const fake = new FakeDocument();
    const win = windowOf(fake);
    const detach = attachActivityListeners(actor, asDocument(fake));

    expect(fake.handlerCount()).toBeGreaterThan(0);
    expect(win.handlerCount()).toBeGreaterThan(0);

    detach();
    expect(fake.handlerCount()).toBe(0);
    expect(win.handlerCount()).toBe(0);

    fake.dispatch("keydown");
    win.dispatch("focus");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("ActivityTracker — DOM-driven state", () => {
  it("reflects input / idle transitions in state.status", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 15_000, inputThrottleMs: 1_000 });
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));
    expect(tracker.state.status).toBe("active");

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(2_000);
      fake.dispatch("keydown");
    }
    expect(tracker.state.status).toBe("active");

    vi.advanceTimersByTime(15_000);
    expect(tracker.state.status).toBe("idle");

    fake.dispatch("keydown");
    expect(tracker.state.status).toBe("active");

    tracker.destroy();
  });

  it("reflects hidden and return in state.status", () => {
    const tracker = new ActivityTracker();
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));

    fake.hidden = true;
    fake.dispatch("visibilitychange");
    expect(tracker.state.status).toBe("hidden");

    fake.hidden = false;
    fake.dispatch("visibilitychange");
    expect(tracker.state.status).toBe("active");

    tracker.destroy();
  });
});

describe("ActivityTracker.on — events", () => {
  it("delivers active / idle / hidden as one-shot events", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1_000, inputThrottleMs: 100 });
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));

    const log: string[] = [];
    tracker.on("active", () => log.push("active"));
    tracker.on("idle", () => log.push("idle"));
    tracker.on("hidden", () => log.push("hidden"));

    vi.advanceTimersByTime(1_000); // → idle
    fake.dispatch("keydown"); // idle → active
    windowOf(fake).dispatch("blur"); // active → hidden
    expect(log).toEqual(["idle", "active", "hidden"]);

    tracker.destroy();
  });

  it("emits `returned` with awayMs after a long absence, and unsubscribes", () => {
    const tracker = new ActivityTracker({ longBlurMs: 1_000 });
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));

    const returns: number[] = [];
    const off = tracker.on("returned", (e) => returns.push(e.awayMs));

    fake.hidden = true;
    fake.dispatch("visibilitychange");
    vi.advanceTimersByTime(5_000);
    fake.hidden = false;
    fake.dispatch("visibilitychange");

    expect(returns).toHaveLength(1);
    expect(returns[0]).toBeGreaterThanOrEqual(5_000);

    off();
    fake.hidden = true;
    fake.dispatch("visibilitychange");
    vi.advanceTimersByTime(5_000);
    fake.hidden = false;
    fake.dispatch("visibilitychange");
    expect(returns).toHaveLength(1); // no more after unsubscribe

    tracker.destroy();
  });

  it("carries the prior status (from) and a timestamp (at)", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1_000 });
    const fake = new FakeDocument();
    tracker.attachDOM(asDocument(fake));

    const events: ActivityEvent[] = [];
    tracker.on("idle", (e) => events.push(e));
    tracker.on("active", (e) => events.push(e));

    vi.advanceTimersByTime(1_000); // active → idle
    fake.dispatch("keydown"); // idle → active

    expect(events[0]).toMatchObject({ type: "idle", from: "active" });
    expect(events[1]).toMatchObject({ type: "active", from: "idle" });
    expect(typeof events[0]?.at).toBe("number");

    tracker.destroy();
  });

  it("fans a transition out to every listener of that event", () => {
    const tracker = new ActivityTracker({ idleAfterMs: 1_000 });
    tracker.attachDOM(asDocument(new FakeDocument()));

    const a: string[] = [];
    const b: string[] = [];
    tracker.on("idle", () => a.push("a"));
    tracker.on("idle", () => b.push("b")); // second listener, same event

    vi.advanceTimersByTime(1_000);
    expect(a).toEqual(["a"]);
    expect(b).toEqual(["b"]);

    tracker.destroy();
  });
});

describe("ActivityTracker.attachDOM", () => {
  it("is idempotent — repeated calls reuse the first detach", () => {
    const tracker = new ActivityTracker();
    const fake = new FakeDocument();
    const first = tracker.attachDOM(asDocument(fake));
    const listeners = fake.handlerCount();
    const second = tracker.attachDOM(asDocument(fake));
    expect(second).toBe(first);
    expect(fake.handlerCount()).toBe(listeners);
    tracker.destroy();
  });

  it("throws a clear error when no document is available", () => {
    const tracker = new ActivityTracker();
    expect(() => tracker.attachDOM()).toThrow(/no document available/);
    tracker.destroy();
  });
});
