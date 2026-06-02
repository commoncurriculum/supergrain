import { effect, signal } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { dispose, reactivePromise, reactiveTask } from "../../src";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("reactivePromise", () => {
  it("transitions to resolved state", async () => {
    const rp = reactivePromise(async () => 42);

    expect(rp.isPending).toBe(true);
    expect(rp.isReady).toBe(false);
    expect(rp.isSettled).toBe(false);

    await rp.promise;

    expect(rp.data).toBe(42);
    expect(rp.error).toBe(null);
    expect(rp.isPending).toBe(false);
    expect(rp.isResolved).toBe(true);
    expect(rp.isRejected).toBe(false);
    expect(rp.isSettled).toBe(true);
    expect(rp.isReady).toBe(true);
  });

  it("transitions to rejected state and preserves previous value", async () => {
    const trigger = signal(0);
    const d1 = deferred<number>();
    const d2 = deferred<number>();
    const deferreds = [d1, d2];
    let call = 0;

    const rp = reactivePromise(async () => {
      trigger();
      return deferreds[call++]!.promise;
    });

    d1.resolve(100);
    await rp.promise;
    expect(rp.data).toBe(100);
    expect(rp.isReady).toBe(true);

    trigger(1); // triggers rerun
    d2.reject(new Error("boom"));
    await rp.promise.catch(() => {});

    expect(rp.isRejected).toBe(true);
    expect(rp.isResolved).toBe(false);
    expect(rp.error).toBeInstanceOf(Error);
    expect((rp.error as Error).message).toBe("boom");
    expect(rp.data).toBe(100); // preserved
    expect(rp.isReady).toBe(true); // sticky
  });

  it("re-runs when a tracked signal changes", async () => {
    const id = signal(1);
    const fn = vi.fn(async () => id() * 10);

    const rp = reactivePromise(fn);
    await rp.promise;
    expect(rp.data).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);

    id(2);
    await rp.promise;
    expect(rp.data).toBe(20);
    expect(fn).toHaveBeenCalledTimes(2);

    id(5);
    await rp.promise;
    expect(rp.data).toBe(50);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("aborts the previous run's AbortSignal when deps change", async () => {
    const trigger = signal(0);
    const aborts: boolean[] = [];

    reactivePromise(async (abortSignal) => {
      trigger();
      const d = deferred<string>();
      abortSignal.addEventListener("abort", () => {
        aborts.push(true);
        d.resolve("aborted");
      });
      return d.promise;
    });

    // First trigger after the auto-run aborts run #1.
    trigger(1);
    await Promise.resolve();
    expect(aborts).toEqual([true]);

    // Second trigger aborts run #2 in turn.
    trigger(2);
    await Promise.resolve();
    expect(aborts).toEqual([true, true]);
  });

  it("discards stale resolutions", async () => {
    const trigger = signal(0);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const deferreds = [d1, d2];
    let call = 0;

    const rp = reactivePromise(async () => {
      trigger();
      return deferreds[call++]!.promise;
    });

    trigger(1); // start second run
    d1.resolve("first");
    await d1.promise;
    // rp.data should NOT be "first" because the second run is newer
    expect(rp.data).toBe(null);

    d2.resolve("second");
    await rp.promise;
    expect(rp.data).toBe("second");
  });

  it("discards stale rejections after a dependency rerun aborts the old run", async () => {
    const trigger = signal(0);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const deferreds = [d1, d2];
    let call = 0;

    const rp = reactivePromise(async () => {
      trigger();
      return deferreds[call++]!.promise;
    });

    trigger(1);
    d1.reject(new Error("stale"));
    await d1.promise.catch(() => {});
    expect(rp.error).toBe(null);
    expect(rp.isRejected).toBe(false);

    d2.resolve("fresh");
    await rp.promise;
    expect(rp.data).toBe("fresh");
  });

  it("promise resolves to the current run's result", async () => {
    const rp = reactivePromise(async () => "hello");
    const v = await rp.promise;
    expect(v).toBe("hello");
  });

  it("promise.catch handles rejection", async () => {
    const rp = reactivePromise(async () => {
      throw new Error("fail");
    });
    const caught = await rp.promise.catch((e) => (e as Error).message);
    expect(caught).toBe("fail");
  });

  it("handles synchronous throws in asyncFn", async () => {
    const rp = reactivePromise<string>(() => {
      throw new Error("sync-fail");
    });
    await rp.promise.catch(() => {});
    expect(rp.isRejected).toBe(true);
    expect((rp.error as Error).message).toBe("sync-fail");
  });
});

describe("reactiveTask", () => {
  it("transitions on run()", async () => {
    const task = reactiveTask(async (x: number) => x * 2);

    expect(task.isPending).toBe(false);
    expect(task.isReady).toBe(false);

    const p = task.run(5);
    expect(task.isPending).toBe(true);

    const v = await p;
    expect(v).toBe(10);
    expect(task.data).toBe(10);
    expect(task.isResolved).toBe(true);
    expect(task.isPending).toBe(false);
    expect(task.isReady).toBe(true);
  });

  it("does not auto-run", async () => {
    const fn = vi.fn(async () => "nope");
    reactiveTask(fn);
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
  });

  it("discards a stale run when a newer run starts", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const results = [d1, d2];
    let call = 0;

    const task = reactiveTask(async () => results[call++]!.promise);

    const p1 = task.run();
    const p2 = task.run();

    d1.resolve("stale");
    await p1;
    // value should not be "stale" — the second run is current
    expect(task.data).toBe(null);

    d2.resolve("fresh");
    await p2;
    expect(task.data).toBe("fresh");
  });

  it("discards a stale rejection when a newer run starts", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const results = [d1, d2];
    let call = 0;

    const task = reactiveTask(async () => results[call++]!.promise);

    const p1 = task.run();
    const p2 = task.run();

    d1.reject(new Error("stale"));
    await p1.catch(() => {});
    expect(task.error).toBe(null);
    expect(task.isRejected).toBe(false);
    expect(task.isPending).toBe(true);

    d2.resolve("fresh");
    await p2;
    expect(task.data).toBe("fresh");
    expect(task.error).toBe(null);
  });

  it("records errors without clobbering a prior success", async () => {
    const task = reactiveTask(async (mode: "ok" | "fail") => {
      if (mode === "fail") throw new Error("no");
      return "yes";
    });

    await task.run("ok");
    expect(task.data).toBe("yes");
    expect(task.isReady).toBe(true);

    await task.run("fail").catch(() => {});
    expect(task.isRejected).toBe(true);
    expect(task.isResolved).toBe(false);
    expect((task.error as Error).message).toBe("no");
    expect(task.data).toBe("yes"); // preserved
    expect(task.isReady).toBe(true); // sticky
  });

  it("clears error on next successful run", async () => {
    const task = reactiveTask(async (mode: "ok" | "fail") => {
      if (mode === "fail") throw new Error("bad");
      return 1;
    });
    await task.run("fail").catch(() => {});
    expect(task.error).toBeDefined();

    await task.run("ok");
    expect(task.error).toBe(null);
    expect(task.isResolved).toBe(true);
  });

  it("handles a synchronous throw inside asyncFn by converting to a rejection", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const task = reactiveTask((_n: number): Promise<number> => {
      throw new Error("sync-boom");
    });

    await expect(task.run(1)).rejects.toThrow("sync-boom");
    expect(task.isRejected).toBe(true);
    expect((task.error as Error).message).toBe("sync-boom");
  });

  it("dispose prevents late completions from mutating task state", async () => {
    const d = deferred<string>();
    const task = reactiveTask(async () => d.promise);

    const pending = task.run();
    expect(task.isPending).toBe(true);

    dispose(task);
    expect(task.isPending).toBe(false);

    d.resolve("done");
    await pending;

    expect(task.data).toBe(null);
    expect(task.error).toBe(null);
    expect(task.isReady).toBe(false);
    expect(task.isResolved).toBe(false);
    expect(task.isRejected).toBe(false);
    expect(task.isSettled).toBe(false);
  });

  it("run() after dispose rejects without mutating state", async () => {
    const task = reactiveTask(async () => "value");
    dispose(task);

    await expect(task.run()).rejects.toThrow("reactiveTask has been disposed");
    expect(task.data).toBe(null);
    expect(task.error).toBe(null);
    expect(task.isPending).toBe(false);
    expect(task.isRejected).toBe(false);
    expect(task.isSettled).toBe(false);
  });
});

// =============================================================================
// Reactive bindings — the consumer side
//
// `rp.isPending`, `rp.data`, `rp.error` (and the `reactiveTask` equivalents)
// are the values UI code subscribes to. The previous tests verified that the
// values are *correct* at given moments, but not that effects actually fire
// when those values transition. These tests pin the reactivity contract that
// makes the API usable from a render loop.
// =============================================================================

describe("reactivePromise — reactive bindings", () => {
  it("an effect tracking isPending fires on resolve", async () => {
    const rp = reactivePromise(async () => 42);
    const history: Array<boolean> = [];
    effect(() => {
      history.push(rp.isPending);
    });

    expect(history).toEqual([true]);
    await rp.promise;
    expect(history.at(-1)).toBe(false);
  });

  it("an effect tracking data fires once data is available", async () => {
    const rp = reactivePromise(async () => "hello");
    const history: Array<unknown> = [];
    effect(() => {
      history.push(rp.data);
    });

    expect(history).toEqual([null]);
    await rp.promise;
    expect(history.at(-1)).toBe("hello");
  });

  it("an effect tracking error fires on rejection and clears on subsequent success", async () => {
    const trigger = signal(0);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const deferreds = [d1, d2];
    let call = 0;

    const rp = reactivePromise(async () => {
      trigger();
      return deferreds[call++]!.promise;
    });

    const history: Array<string | undefined> = [];
    effect(() => {
      history.push(rp.error == null ? undefined : (rp.error as Error).message);
    });

    expect(history).toEqual([undefined]);

    d1.reject(new Error("first-fail"));
    await rp.promise.catch(() => {});
    expect(history.at(-1)).toBe("first-fail");

    trigger(1);
    d2.resolve("ok");
    await rp.promise;
    expect(history.at(-1)).toBeUndefined();
  });
});

describe("reactiveTask — reactive bindings", () => {
  it("an effect tracking isPending fires on run() and again on settle", async () => {
    const d = deferred<number>();
    const task = reactiveTask(async () => d.promise);

    const history: Array<boolean> = [];
    effect(() => {
      history.push(task.isPending);
    });

    expect(history).toEqual([false]);

    const pending = task.run();
    expect(history.at(-1)).toBe(true);

    d.resolve(7);
    await pending;
    expect(history.at(-1)).toBe(false);
    expect(task.data).toBe(7);
  });
});

describe("reactivePromise — stale rejection", () => {
  it("ignores rejection from a run whose AbortSignal is already aborted", async () => {
    const trigger = signal(0);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const rp = reactivePromise<string>(async (abortSignal) => {
      trigger();
      return new Promise<string>((_resolve, reject) => {
        abortSignal.addEventListener("abort", () => {
          reject(new Error("aborted-by-rerun"));
        });
      });
    });

    trigger(1);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(rp.isRejected).toBe(false);
    expect(rp.error).toBe(null);

    errSpy.mockRestore();
  });
});
