// Node-environment tests for the deferred disposal queue. Without
// requestAnimationFrame (node), scheduleDisposal falls back to a plain
// setTimeout, which fake timers drive deterministically.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { scheduleDisposal } from "../../src/react/disposal-queue";

const queue = (dispose: () => void) => scheduleDisposal({ dispose });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduleDisposal", () => {
  it("defers disposers to a later macrotask and runs them in order", () => {
    const order: Array<string> = [];
    queue(() => order.push("a"));
    queue(() => order.push("b"));

    expect(order).toEqual([]);
    vi.runAllTimers();
    expect(order).toEqual(["a", "b"]);
  });

  it("schedules a fresh flush for disposers queued after a flush", () => {
    const first = vi.fn();
    const second = vi.fn();

    queue(first);
    vi.runAllTimers();
    expect(first).toHaveBeenCalledTimes(1);

    queue(second);
    vi.runAllTimers();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps draining when a disposer throws, then surfaces the first error", () => {
    const ran: Array<string> = [];
    queue(() => {
      throw new Error("first boom");
    });
    queue(() => {
      ran.push("after-first");
      throw new Error("second boom");
    });
    queue(() => ran.push("last"));

    expect(() => vi.runAllTimers()).toThrow("first boom");
    expect(ran).toEqual(["after-first", "last"]);
  });

  it("wraps non-Error throwables before surfacing them", () => {
    const after = vi.fn();
    queue(() => {
      throw "plain string failure"; // eslint-disable-line no-throw-literal -- exercising the non-Error path
    });
    queue(after);

    expect(() => vi.runAllTimers()).toThrow("plain string failure");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("runs a disposer queued while draining, and still flushes later rounds", () => {
    const ran: Array<string> = [];
    queue(() => {
      ran.push("outer");
      queue(() => ran.push("inner"));
    });
    vi.runAllTimers();
    expect(ran).toEqual(["outer", "inner"]);

    queue(() => ran.push("later"));
    vi.runAllTimers();
    expect(ran).toEqual(["outer", "inner", "later"]);
  });
});
