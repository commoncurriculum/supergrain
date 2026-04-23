import { describe, it, expect, vi } from "vitest";

import { reactivePromise, reactiveTask, signal } from "../../src";

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

    await rp;

    expect(rp.value).toBe(42);
    expect(rp.error).toBe(null);
    expect(rp.isPending).toBe(false);
    expect(rp.isResolved).toBe(true);
    expect(rp.isRejected).toBe(false);
    expect(rp.isSettled).toBe(true);
    expect(rp.isReady).toBe(true);

    rp.dispose();
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
    await rp;
    expect(rp.value).toBe(100);
    expect(rp.isReady).toBe(true);

    trigger(1); // triggers rerun
    d2.reject(new Error("boom"));
    await rp.catch(() => {});

    expect(rp.isRejected).toBe(true);
    expect(rp.isResolved).toBe(false);
    expect(rp.error).toBeInstanceOf(Error);
    expect((rp.error as Error).message).toBe("boom");
    expect(rp.value).toBe(100); // preserved
    expect(rp.isReady).toBe(true); // sticky

    rp.dispose();
  });

  it("re-runs when a tracked signal changes", async () => {
    const id = signal(1);
    const fn = vi.fn(async () => id() * 10);

    const rp = reactivePromise(fn);
    await rp;
    expect(rp.value).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);

    id(2);
    await rp;
    expect(rp.value).toBe(20);
    expect(fn).toHaveBeenCalledTimes(2);

    id(5);
    await rp;
    expect(rp.value).toBe(50);
    expect(fn).toHaveBeenCalledTimes(3);

    rp.dispose();
  });

  it("aborts the previous run's AbortSignal when deps change", async () => {
    const trigger = signal(0);
    const aborts: boolean[] = [];

    const rp = reactivePromise(async (abort) => {
      trigger();
      const d = deferred<string>();
      abort.addEventListener("abort", () => {
        aborts.push(true);
        d.resolve("aborted");
      });
      return d.promise;
    });

    trigger(1);
    await Promise.resolve(); // let microtasks flush
    expect(aborts.length).toBeGreaterThanOrEqual(1);

    rp.dispose();
    expect(aborts.at(-1)).toBe(true);
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
    // rp.value should NOT be "first" because the second run is newer
    expect(rp.value).toBe(null);

    d2.resolve("second");
    await rp;
    expect(rp.value).toBe("second");

    rp.dispose();
  });

  it("dispose() stops further re-runs", async () => {
    const trigger = signal(0);
    const fn = vi.fn(async () => trigger());

    const rp = reactivePromise(fn);
    await rp;
    expect(fn).toHaveBeenCalledTimes(1);

    rp.dispose();
    trigger(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1); // no rerun
  });

  it("is thenable and awaits resolve to current run's result", async () => {
    const rp = reactivePromise(async () => "hello");
    const v = await rp;
    expect(v).toBe("hello");
    rp.dispose();
  });

  it("catch handles rejection", async () => {
    const rp = reactivePromise(async () => {
      throw new Error("fail");
    });
    const caught = await rp.catch((e) => (e as Error).message);
    expect(caught).toBe("fail");
    rp.dispose();
  });

  it("handles synchronous throws in asyncFn", async () => {
    const rp = reactivePromise(() => {
      throw new Error("sync-fail");
    });
    await rp.catch(() => {});
    expect(rp.isRejected).toBe(true);
    expect((rp.error as Error).message).toBe("sync-fail");
    rp.dispose();
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
    expect(task.value).toBe(10);
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
    expect(task.value).toBe(null);

    d2.resolve("fresh");
    await p2;
    expect(task.value).toBe("fresh");
  });

  it("records errors without clobbering a prior success", async () => {
    const task = reactiveTask(async (mode: "ok" | "fail") => {
      if (mode === "fail") throw new Error("no");
      return "yes";
    });

    await task.run("ok");
    expect(task.value).toBe("yes");
    expect(task.isReady).toBe(true);

    await task.run("fail").catch(() => {});
    expect(task.isRejected).toBe(true);
    expect(task.isResolved).toBe(false);
    expect((task.error as Error).message).toBe("no");
    expect(task.value).toBe("yes"); // preserved
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
});
