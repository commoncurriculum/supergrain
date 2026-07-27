// Node-environment tests for the deferred disposal queue. Without
// requestAnimationFrame (node), scheduleDisposal falls back to a plain
// setTimeout, which fake timers drive deterministically.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { scheduleDisposal } from "../../src/react/disposal-queue";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduleDisposal", () => {
  it("defers disposers to a later macrotask and runs them in order", () => {
    const order: Array<string> = [];
    scheduleDisposal(() => order.push("a"));
    scheduleDisposal(() => order.push("b"));

    expect(order).toEqual([]);
    vi.runAllTimers();
    expect(order).toEqual(["a", "b"]);
  });

  it("schedules a fresh flush for disposers queued after a flush", () => {
    const first = vi.fn();
    const second = vi.fn();

    scheduleDisposal(first);
    vi.runAllTimers();
    expect(first).toHaveBeenCalledTimes(1);

    scheduleDisposal(second);
    vi.runAllTimers();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps draining when a disposer throws, then surfaces the first error", () => {
    const ran: Array<string> = [];
    scheduleDisposal(() => {
      throw new Error("first boom");
    });
    scheduleDisposal(() => {
      ran.push("after-first");
      throw new Error("second boom");
    });
    scheduleDisposal(() => ran.push("last"));

    expect(() => vi.runAllTimers()).toThrow("first boom");
    expect(ran).toEqual(["after-first", "last"]);
  });
});
