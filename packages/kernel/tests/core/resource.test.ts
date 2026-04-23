import { describe, it, expect, vi } from "vitest";

import { resource, dispose, signal } from "../../src";

describe("resource()", () => {
  it("returns the initial state reactively", () => {
    const r = resource({ value: 0 }, () => {
      // setup doesn't touch state; initial stays
    });
    expect(r.value).toBe(0);
    dispose(r);
  });

  it("setup can mutate state directly via assignment", () => {
    const r = resource({ value: 0 }, (state) => {
      state.value = 42;
    });
    expect(r.value).toBe(42);
    dispose(r);
  });

  it("tracks signal reads in setup and reruns when they change", () => {
    const input = signal(1);
    const setupSpy = vi.fn();

    const r = resource({ value: 0 }, (state) => {
      setupSpy();
      state.value = input() * 10;
    });

    expect(r.value).toBe(10);
    expect(setupSpy).toHaveBeenCalledTimes(1);

    input(2);
    expect(r.value).toBe(20);
    expect(setupSpy).toHaveBeenCalledTimes(2);

    dispose(r);
  });

  it("runs returned cleanup before each rerun", () => {
    const trigger = signal(0);
    const cleanup = vi.fn();

    const r = resource({ value: 0 }, (state) => {
      state.value = trigger();
      return cleanup;
    });

    expect(cleanup).not.toHaveBeenCalled();

    trigger(1);
    expect(cleanup).toHaveBeenCalledTimes(1);

    trigger(2);
    expect(cleanup).toHaveBeenCalledTimes(2);

    dispose(r);
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it("runs cleanup registered via onCleanup", () => {
    const trigger = signal(0);
    const cleanup = vi.fn();

    const r = resource({ value: 0 }, (state, { onCleanup }) => {
      state.value = trigger();
      onCleanup(cleanup);
    });

    expect(cleanup).not.toHaveBeenCalled();
    trigger(1);
    expect(cleanup).toHaveBeenCalledTimes(1);

    dispose(r);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("trips the AbortSignal on rerun and dispose", () => {
    const trigger = signal(0);
    const signals: Array<AbortSignal> = [];

    const r = resource({ value: 0 }, (state, { abortSignal }) => {
      signals.push(abortSignal);
      state.value = trigger();
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    trigger(1);
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);

    dispose(r);
    expect(signals[1]!.aborted).toBe(true);
  });

  it("dispose stops setup from reacting to further signal changes", () => {
    const trigger = signal(0);
    const setupSpy = vi.fn();

    const r = resource({ value: 0 }, (state) => {
      setupSpy();
      state.value = trigger();
    });

    expect(setupSpy).toHaveBeenCalledTimes(1);
    dispose(r);

    trigger(1);
    trigger(2);
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(r.value).toBe(0);
  });

  it("dispose is idempotent", () => {
    const cleanup = vi.fn();
    const r = resource({ value: 0 }, () => cleanup);

    dispose(r);
    dispose(r);
    dispose(r);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("supports async setup that registers cleanup via onCleanup", async () => {
    const cleanup = vi.fn();
    const r = resource<{ status: string }>(
      { status: "loading" },
      async (state, { onCleanup, abortSignal }) => {
        onCleanup(cleanup);
        await new Promise((res) => setTimeout(res, 0));
        if (abortSignal.aborted) return;
        state.status = "done";
      },
    );

    expect(r.status).toBe("loading");
    await new Promise((res) => setTimeout(res, 5));
    expect(r.status).toBe("done");

    dispose(r);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("aborts the previous async setup on rerun", async () => {
    const input = signal(1);
    const results: Array<number> = [];

    const r = resource({ value: null as number | null }, async (state, { abortSignal }) => {
      const v = input();
      await new Promise((res) => setTimeout(res, 10));
      if (abortSignal.aborted) return;
      state.value = v;
      results.push(v);
    });

    await new Promise((res) => setTimeout(res, 2));
    input(2);

    await new Promise((res) => setTimeout(res, 30));

    // Only the second run's result should land
    expect(results).toEqual([2]);
    expect(r.value).toBe(2);

    dispose(r);
  });

  it("exposes a reactive proxy — mutations are tracked per-field", () => {
    const r = resource(
      { data: null as string | null, error: null as Error | null, isLoading: true },
      (state) => {
        state.data = "hello";
        state.isLoading = false;
      },
    );

    expect(r.data).toBe("hello");
    expect(r.isLoading).toBe(false);
    expect(r.error).toBe(null);

    dispose(r);
  });
});

describe("dispose()", () => {
  it("no-op on non-resource objects", () => {
    // should not throw
    dispose({});
    dispose({ foo: 1 });
  });
});
