import { signal } from "@supergrain/kernel";
import { describe, it } from "vitest";

import { reactivePromise, reactiveTask, resource, dispose } from "../../src";
import {
  HAS_GC,
  RUN_SOAK,
  collectHeapSamples,
  delay,
  expectCollectible,
  expectRetainedHeapBudget,
  expectTrendToFlatten,
} from "./helpers";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface HuskPayload {
  id: number;
  values: Array<number>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makePayload(seed: number, width = 24): Array<HuskPayload> {
  return Array.from({ length: width }, (_, index) => ({
    id: seed * 1_000 + index,
    values: Array.from({ length: 18 }, (__, offset) => seed + index + offset),
  }));
}

async function runHuskCycle(seed: number): Promise<void> {
  const resourceTrigger = signal(0);
  const resourceDeferreds: Array<Deferred<number>> = [];
  const asyncResource = resource(
    { value: 0, payload: makePayload(seed) },
    async (state, { abortSignal }) => {
      const current = resourceTrigger();
      const run = deferred<number>();
      resourceDeferreds.push(run);
      const value = await run.promise;
      if (abortSignal.aborted) return;
      state.value = current + value;
      state.payload = makePayload(seed + value);
    },
  );

  resourceTrigger(1);

  const promiseTrigger = signal(0);
  const promiseDeferreds: Array<Deferred<{ value: number; payload: Array<HuskPayload> }>> = [];
  const reactive = reactivePromise(async (abortSignal) => {
    const current = promiseTrigger();
    const run = deferred<{ value: number; payload: Array<HuskPayload> }>();
    abortSignal.addEventListener("abort", () =>
      run.resolve({ value: current, payload: makePayload(seed) }),
    );
    promiseDeferreds.push(run);
    return run.promise;
  });

  promiseTrigger(1);
  promiseTrigger(2);

  const task = reactiveTask(async (mode: "ok" | "fail", value: number) => {
    if (mode === "fail") throw new Error(`task-${value}`);
    return { value, payload: makePayload(seed + value, 12) };
  });

  const okRun = task.run("ok", seed);
  const failedRun = task.run("fail", seed).catch(() => undefined);

  dispose(asyncResource);
  dispose(reactive as object);

  for (const run of resourceDeferreds) {
    run.resolve(seed);
  }
  for (const run of promiseDeferreds) {
    run.resolve({ value: seed, payload: makePayload(seed + 1, 16) });
  }

  await Promise.allSettled([
    okRun,
    failedRun,
    ...resourceDeferreds.map((run) => run.promise),
    ...promiseDeferreds.map((run) => run.promise),
  ]);
  await delay();
}

describe.runIf(HAS_GC)("husk memory", () => {
  it("collects disposed resources after async cleanup races", async () => {
    await expectCollectible(async () => {
      const trigger = signal(0);
      const pending: Array<Deferred<number>> = [];
      const trackedResource = resource(
        { value: 0, payload: makePayload(1, 8) },
        async (state, { abortSignal }) => {
          const current = trigger();
          const run = deferred<number>();
          pending.push(run);
          const value = await run.promise;
          if (abortSignal.aborted) return;
          state.value = current + value;
          state.payload = makePayload(value, 8);
        },
      );

      trigger(1);

      return {
        targets: [trackedResource as object, trackedResource.payload[0] as object],
        teardown: () => dispose(trackedResource),
        settle: async () => {
          for (const run of pending) {
            run.resolve(1);
          }
          await Promise.allSettled(pending.map((run) => run.promise));
          await delay();
        },
      };
    });
  });

  it("collects disposed reactivePromise envelopes after stale runs settle", async () => {
    await expectCollectible(async () => {
      const trigger = signal(0);
      const pending: Array<Deferred<{ value: number; payload: Array<HuskPayload> }>> = [];
      const reactive = reactivePromise(async (abortSignal) => {
        const current = trigger();
        const run = deferred<{ value: number; payload: Array<HuskPayload> }>();
        abortSignal.addEventListener("abort", () =>
          run.resolve({ value: current, payload: makePayload(current, 8) }),
        );
        pending.push(run);
        return run.promise;
      });

      trigger(1);

      return {
        targets: [reactive as object],
        teardown: () => dispose(reactive as object),
        settle: async () => {
          for (const run of pending) {
            run.resolve({ value: 1, payload: makePayload(2, 8) });
          }
          await Promise.allSettled(pending.map((run) => run.promise));
          await delay();
        },
      };
    });
  });

  it("keeps retained heap bounded across repeated async abort, cleanup, and task churn", async () => {
    await expectRetainedHeapBudget(async () => {
      for (let index = 0; index < 120; index++) {
        await runHuskCycle(index);
      }
    }, 3_500_000);
  });

  it("flattens retained heap across repeated async rounds", async () => {
    const samples = await collectHeapSamples(6, async (round) => {
      for (let index = 0; index < 60; index++) {
        await runHuskCycle(round * 1_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 3_500_000,
      maxPositiveDeltas: 4,
      maxLastDeltaBytes: 600_000,
    });
  });
});

describe.runIf(HAS_GC && RUN_SOAK)("husk memory soak", () => {
  it("stays flat during extended async rerun churn", async () => {
    const samples = await collectHeapSamples(10, async (round) => {
      for (let index = 0; index < 100; index++) {
        await runHuskCycle(round * 10_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 5_000_000,
      maxPositiveDeltas: 6,
      maxLastDeltaBytes: 850_000,
    });
  });
});
