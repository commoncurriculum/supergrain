import { createReactive, signal } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { resource, defineResource, dispose } from "../../src";

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

describe("defineResource()", () => {
  it("returns a factory that produces independent instances", () => {
    const factory = defineResource<void, { value: number }>(
      () => ({ value: 0 }),
      (state) => {
        state.value = 42;
      },
    );

    const a = factory();
    const b = factory();

    expect(a.value).toBe(42);
    expect(b.value).toBe(42);
    expect(a).not.toBe(b);

    a.value = 100;
    expect(b.value).toBe(42); // independent state

    dispose(a);
    dispose(b);
  });

  it("tracks reactive reads in argsFn and reruns setup when they change", () => {
    const setupSpy = vi.fn();
    const factory = defineResource<number, { doubled: number }>(
      () => ({ doubled: 0 }),
      (state, n) => {
        setupSpy(n);
        state.doubled = n * 2;
      },
    );

    const store = createReactive({ n: 3 });
    const r = factory(() => store.n);

    expect(r.doubled).toBe(6);
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(setupSpy).toHaveBeenLastCalledWith(3);

    store.n = 7;
    expect(r.doubled).toBe(14);
    expect(setupSpy).toHaveBeenCalledTimes(2);
    expect(setupSpy).toHaveBeenLastCalledWith(7);

    dispose(r);
  });

  it("does NOT track reactive reads inside setup", () => {
    const setupSpy = vi.fn();
    const store = createReactive({ side: 0 });

    const factory = defineResource<number, { value: number }>(
      () => ({ value: 0 }),
      (state, n) => {
        setupSpy();
        // Reactive read inside setup must NOT drive reruns
        state.value = n + store.side;
      },
    );

    const r = factory(() => 1);

    expect(r.value).toBe(1);
    expect(setupSpy).toHaveBeenCalledTimes(1);

    store.side = 100;
    // setup must not rerun — reads inside setup are untracked
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(r.value).toBe(1);

    dispose(r);
  });

  it("supports factories with no args (Args = void)", () => {
    let runs = 0;
    const factory = defineResource<void, { count: number }>(
      () => ({ count: 0 }),
      (state) => {
        state.count = ++runs;
      },
    );

    const r = factory();
    expect(r.count).toBe(1);
    dispose(r);
  });

  it("trips AbortSignal and runs cleanups on rerun", () => {
    const aborts: Array<AbortSignal> = [];
    const cleanupSpy = vi.fn();

    const factory = defineResource<number, { value: number }>(
      () => ({ value: 0 }),
      (state, n, { abortSignal, onCleanup }) => {
        aborts.push(abortSignal);
        state.value = n;
        onCleanup(cleanupSpy);
      },
    );

    const input = signal(1);
    const r = factory(() => input());

    expect(aborts).toHaveLength(1);
    expect(aborts[0]!.aborted).toBe(false);

    input(2);
    expect(aborts).toHaveLength(2);
    expect(aborts[0]!.aborted).toBe(true);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    dispose(r);
    expect(aborts[1]!.aborted).toBe(true);
    expect(cleanupSpy).toHaveBeenCalledTimes(2);
  });

  it("each factory-produced instance has its own lifecycle", () => {
    const cleanups = vi.fn();

    const factory = defineResource<number, { value: number }>(
      () => ({ value: 0 }),
      (state, n) => {
        state.value = n;
        return cleanups;
      },
    );

    const s1 = signal(1);
    const s2 = signal(10);
    const a = factory(() => s1());
    const b = factory(() => s2());

    expect(a.value).toBe(1);
    expect(b.value).toBe(10);

    s1(2);
    expect(a.value).toBe(2);
    expect(b.value).toBe(10);
    expect(cleanups).toHaveBeenCalledTimes(1);

    dispose(a);
    expect(cleanups).toHaveBeenCalledTimes(2);
    expect(b.value).toBe(10); // unaffected

    dispose(b);
    expect(cleanups).toHaveBeenCalledTimes(3);
  });
});

describe("resource() error handling", () => {
  it("logs and swallows an error thrown from a cleanup function", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const trigger = signal(0);

    const r = resource({ value: 0 }, (state) => {
      state.value = trigger();
      return () => {
        throw new Error("cleanup-boom");
      };
    });

    trigger(1); // triggers rerun → cleanup throws
    expect(errSpy).toHaveBeenCalledWith(
      "[supergrain/resource] cleanup threw:",
      expect.any(Error),
    );

    errSpy.mockRestore();
    dispose(r);
  });

  it("runs onCleanup immediately when the resource is disposed before it fires", async () => {
    const immediateCleanup = vi.fn();
    const r = resource<{ status: string }>(
      { status: "loading" },
      async (_state, { onCleanup }) => {
        // Yield so dispose() can run before onCleanup is called
        await new Promise((res) => setTimeout(res, 5));
        onCleanup(immediateCleanup); // resource already disposed → runs immediately
      },
    );

    dispose(r); // dispose before the async setup registers onCleanup
    await new Promise((res) => setTimeout(res, 20));
    expect(immediateCleanup).toHaveBeenCalledTimes(1);
  });

  it("logs and swallows a late-cleanup throw when called after dispose", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = resource<{ status: string }>(
      { status: "loading" },
      async (_state, { onCleanup }) => {
        await new Promise((res) => setTimeout(res, 5));
        onCleanup(() => {
          throw new Error("late-cleanup-boom");
        });
      },
    );

    dispose(r);
    await new Promise((res) => setTimeout(res, 20));
    expect(errSpy).toHaveBeenCalledWith(
      "[supergrain/resource] late cleanup threw:",
      expect.any(Error),
    );

    errSpy.mockRestore();
  });

  it("logs and swallows a non-AbortError rejection from async setup", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = resource<{ status: string }>(
      { status: "loading" },
      async () => {
        await Promise.reject(new Error("async-setup-boom"));
      },
    );

    await new Promise((res) => setTimeout(res, 10));
    expect(errSpy).toHaveBeenCalledWith(
      "[supergrain/resource] async setup rejected:",
      expect.any(Error),
    );

    errSpy.mockRestore();
    dispose(r);
  });

  it("silently swallows an AbortError rejection from async setup", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const trigger = signal(0);

    const r = resource<{ status: string }>(
      { status: "init" },
      async (_state, ctx) => {
        trigger(); // track signal so rerun is triggered by signal change
        await new Promise<void>((_resolve, reject) => {
          ctx.abortSignal.addEventListener("abort", () => {
            const err = new Error("aborted");
            (err as Error & { name: string }).name = "AbortError";
            reject(err);
          });
        });
      },
    );

    trigger(1); // triggers rerun → aborts old run → old promise rejects with AbortError
    await new Promise((res) => setTimeout(res, 20));

    // console.error must NOT have been called — AbortError is silently swallowed
    expect(errSpy).not.toHaveBeenCalled();

    errSpy.mockRestore();
    dispose(r);
  });

  it("does not log a stale non-AbortError rejection when generation has moved on", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const trigger = signal(0);
    const rejects: Array<(e: Error) => void> = [];

    const r = resource<{ status: string }>(
      { status: "init" },
      async (_state, ctx) => {
        trigger(); // tracked — rerun on signal change
        // Capture the reject for each run so we can reject the OLD run manually
        await new Promise<void>((_resolve, reject) => {
          rejects.push(reject as (e: Error) => void);
          // Don't auto-reject on abort — we want to control the timing
          ctx.abortSignal.addEventListener("abort", () => {
            // Intentionally do nothing: we'll reject manually below
          });
        });
      },
    );

    // Wait for first run to register its reject
    await new Promise((res) => setTimeout(res, 5));

    trigger(1); // bump signal → generation=2, first run aborted
    await new Promise((res) => setTimeout(res, 5));

    // Reject the OLD run (rejects[0]) with a non-AbortError AFTER generation has moved on
    // gen=1 !== generation=2 → console.error should NOT be called (line 129 false branch)
    rejects[0]!(new Error("stale-but-not-abort-error"));
    await new Promise((res) => setTimeout(res, 10));

    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
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
