import { signal } from "@supergrain/kernel";
import {
  HAS_GC,
  assertGcAvailable,
  collectHeapSamples,
  delay,
  expectCollectible,
  expectRetainedHeapBudget,
  expectTrendToFlatten,
} from "@supergrain/test-utils/memory";
import { describe, it } from "vitest";

import { defineResource, dispose, reactivePromise, resource } from "../../src";
import {
  type Deferred,
  type HuskPayload,
  deferred,
  makePayload,
  runDefineResourceCycle,
  runHuskCycle,
} from "./fixtures";

// Always-run sentinel: ensures the memory config actually exposed GC.
it("GC is exposed (required for all husk memory tests)", () => {
  assertGcAvailable();
});

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

  it("collects resource disposed BEFORE any deferred resolves (abort-before-resolve)", async () => {
    await expectCollectible(async () => {
      const trigger = signal(0);
      const pending: Array<Deferred<number>> = [];
      const trackedResource = resource(
        { value: 0, payload: makePayload(10, 6) },
        async (state, { abortSignal }) => {
          const run = deferred<number>();
          abortSignal.addEventListener("abort", () => run.resolve(0));
          pending.push(run);
          const value = await run.promise;
          if (abortSignal.aborted) return;
          state.value = value;
        },
      );

      trigger(1);
      // Dispose immediately, before any deferred has resolved
      dispose(trackedResource);

      return {
        targets: [trackedResource as object],
        settle: async () => {
          for (const run of pending) run.resolve(0);
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

  it("collects defineResource instances after all are disposed", async () => {
    await expectCollectible(async () => {
      const fetchData = defineResource<number, { value: number; payload: Array<HuskPayload> }>(
        () => ({ value: 0, payload: makePayload(42) }),
        async (state, _url, { abortSignal }) => {
          const run = deferred<number>();
          abortSignal.addEventListener("abort", () => run.resolve(0));
          const v = await run.promise;
          if (abortSignal.aborted) return;
          state.value = v;
        },
      );

      const trigger = signal(1);
      const inst = fetchData(() => trigger());
      trigger(2);

      return {
        targets: [inst as object],
        teardown: () => dispose(inst),
        settle: () => delay(),
      };
    });
  });

  // Targeted abort-listener leak test. Resources register addEventListener("abort")
  // on the AbortSignal; if those listeners aren't released when the resource is
  // disposed cleanly (no abort fired), the signal accumulates listeners across
  // many disposal cycles. We hold a single AbortController across N resources
  // so any listener leak is observable as growing retention against that
  // controller's signal.
  it("does not leak abort listeners across many resource lifecycles sharing one signal", async () => {
    await expectRetainedHeapBudget(async () => {
      const sharedController = new AbortController();
      const sharedSignal = sharedController.signal;
      for (let index = 0; index < 200; index++) {
        const trigger = signal(0);
        const pending: Array<Deferred<number>> = [];
        const r = resource(
          { value: 0, payload: makePayload(index, 4) },
          async (state, { abortSignal }) => {
            sharedSignal.addEventListener("abort", () => undefined);
            abortSignal.addEventListener("abort", () => undefined);
            const run = deferred<number>();
            pending.push(run);
            const v = await run.promise;
            if (abortSignal.aborted) return;
            state.value = v;
          },
        );
        trigger(1);
        dispose(r);
        for (const run of pending) run.resolve(index);
        await Promise.allSettled(pending.map((run) => run.promise));
        await delay();
      }
      sharedController.abort();
    }, 3_000_000);
  });

  it("keeps retained heap bounded across repeated async abort, cleanup, and task churn", async () => {
    await expectRetainedHeapBudget(async () => {
      for (let index = 0; index < 120; index++) {
        await runHuskCycle(index);
      }
    }, 3_500_000);
  });

  // High-N retention test for the racy resource/promise/task cycle. If any
  // path retains references at a per-cycle linear rate this blows past budget;
  // bounded retention proves the cleanup paths actually run.
  it("retained heap stays sublinear across 600 async cycles", async () => {
    await expectRetainedHeapBudget(async () => {
      for (let index = 0; index < 600; index++) {
        await runHuskCycle(index);
      }
    }, 6_500_000);
  });

  it("keeps retained heap bounded across repeated defineResource factory churn", async () => {
    await expectRetainedHeapBudget(async () => {
      for (let index = 0; index < 80; index++) {
        await runDefineResourceCycle(index);
      }
    }, 3_000_000);
  });

  it("flattens retained heap across repeated async rounds", async () => {
    const samples = await collectHeapSamples(8, async (round) => {
      for (let index = 0; index < 60; index++) {
        await runHuskCycle(round * 1_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 3_500_000,
      maxLastDeltaBytes: 600_000,
      maxTailHeadRatio: 1.8,
    });
  });

  it("flattens retained heap across repeated defineResource factory rounds", async () => {
    const samples = await collectHeapSamples(8, async (round) => {
      for (let index = 0; index < 40; index++) {
        await runDefineResourceCycle(round * 1_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 3_000_000,
      maxLastDeltaBytes: 500_000,
      maxTailHeadRatio: 1.8,
      maxConsecutiveGrowthRounds: 4,
    });
  });
});
