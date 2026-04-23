import { describe, it, expect, vi } from "vitest";

import { resource, signal } from "../../src";

describe("resource()", () => {
  it("exposes the initial value before setup sets anything", () => {
    const r = resource(0, () => {
      // no set — value stays at initial
    });
    expect(r.value).toBe(0);
    r.dispose();
  });

  it("updates .value when setup calls set()", () => {
    const r = resource(0, ({ set }) => {
      set(42);
    });
    expect(r.value).toBe(42);
    r.dispose();
  });

  it("tracks signal reads in setup and reruns when they change", () => {
    const input = signal(1);
    const setupSpy = vi.fn();

    const r = resource(0, ({ set }) => {
      setupSpy();
      set(input() * 10);
    });

    expect(r.value).toBe(10);
    expect(setupSpy).toHaveBeenCalledTimes(1);

    input(2);
    expect(r.value).toBe(20);
    expect(setupSpy).toHaveBeenCalledTimes(2);

    r.dispose();
  });

  it("runs cleanup registered via onCleanup before each rerun", () => {
    const trigger = signal(0);
    const cleanup = vi.fn();

    const r = resource<number>(0, ({ set, onCleanup }) => {
      const n = trigger();
      set(n);
      onCleanup(cleanup);
    });

    expect(cleanup).not.toHaveBeenCalled();

    trigger(1);
    expect(cleanup).toHaveBeenCalledTimes(1);

    trigger(2);
    expect(cleanup).toHaveBeenCalledTimes(2);

    r.dispose();
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it("runs cleanup returned from sync setup", () => {
    const trigger = signal(0);
    const cleanup = vi.fn();

    const r = resource(0, ({ set }) => {
      set(trigger());
      return cleanup;
    });

    expect(cleanup).not.toHaveBeenCalled();
    trigger(1);
    expect(cleanup).toHaveBeenCalledTimes(1);

    r.dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("aborts the signal on rerun and dispose", () => {
    const trigger = signal(0);
    let signals: Array<AbortSignal> = [];

    const r = resource(0, ({ signal: sig, set }) => {
      signals.push(sig);
      set(trigger());
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    trigger(1);
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);

    r.dispose();
    expect(signals[1]!.aborted).toBe(true);
  });

  it("dispose stops setup from reacting to further signal changes", () => {
    const trigger = signal(0);
    const setupSpy = vi.fn();

    const r = resource(0, ({ set }) => {
      setupSpy();
      set(trigger());
    });

    expect(setupSpy).toHaveBeenCalledTimes(1);
    r.dispose();

    trigger(1);
    trigger(2);
    expect(setupSpy).toHaveBeenCalledTimes(1);
    // Value frozen at last pre-dispose state
    expect(r.value).toBe(0);
  });

  it("peek() reads current value without subscribing", () => {
    const r = resource(0, ({ set, peek }) => {
      // Using peek to read own state without creating a dep loop
      set(peek() + 1);
    });
    expect(r.value).toBe(1);
    r.dispose();
  });

  it("supports async setup that registers cleanup via onCleanup", async () => {
    const cleanup = vi.fn();
    let resolved = false;

    const r = resource<string>("loading", async ({ set, onCleanup, signal: sig }) => {
      onCleanup(cleanup);
      await new Promise((r) => setTimeout(r, 0));
      if (sig.aborted) return;
      set("done");
      resolved = true;
    });

    expect(r.value).toBe("loading");
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(true);
    expect(r.value).toBe("done");

    r.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("aborts the previous async setup on rerun", async () => {
    const input = signal(1);
    const results: Array<number> = [];

    const r = resource<number | undefined>(undefined, async ({ set, signal: sig }) => {
      const v = input();
      await new Promise((r) => setTimeout(r, 10));
      if (sig.aborted) return;
      set(v);
      results.push(v);
    });

    // Change input before the first setTimeout resolves
    await new Promise((r) => setTimeout(r, 2));
    input(2);

    await new Promise((r) => setTimeout(r, 30));

    // Only the second run's result should land
    expect(results).toEqual([2]);
    expect(r.value).toBe(2);

    r.dispose();
  });
});
