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

import {
  createAsyncStore,
  flushFinder,
  makeDashboard,
  makeUser,
  settleStoreRound,
} from "./fixtures";

it("GC is exposed (required for all silo memory tests)", () => {
  assertGcAvailable();
});

describe.runIf(HAS_GC)("silo memory", () => {
  it("collects stores and handles after clearMemory and dropping the store", async () => {
    await expectCollectible(async () => {
      const { store, docCalls, queryCalls } = createAsyncStore();
      const userHandle = store.find("user", "1");
      const queryHandle = store.findQuery("dashboard", { workspaceId: 7, active: true });

      await flushFinder();

      docCalls[0]!.deferred.resolve([makeUser("1", 7)]);
      queryCalls[0]!.deferred.resolve([makeDashboard({ workspaceId: 7, active: true }, 7)]);

      await Promise.allSettled([
        userHandle.promise ?? Promise.resolve(undefined),
        queryHandle.promise ?? Promise.resolve(undefined),
        ...docCalls.map((call) => call.deferred.promise),
        ...queryCalls.map((call) => call.deferred.promise),
      ]);

      store.clearMemory();

      return {
        targets: [store as object, userHandle as object, queryHandle as object],
        settle: () => delay(),
      };
    });
  });

  it("keeps retained heap bounded across repeated batching, clearMemory, and async settlement", async () => {
    await expectRetainedHeapBudget(async () => {
      for (let index = 0; index < 80; index++) {
        await settleStoreRound(index);
      }
    }, 4_000_000);
  });

  // High-N retention test against fresh stores per round. If the per-round
  // create + use + clearMemory + drop cycle leaks any references at a linear
  // rate this test will exceed budget; bounded retention proves the store
  // tear-down path actually releases.
  it("retained heap stays sublinear across 400 settle rounds", async () => {
    await expectRetainedHeapBudget(async () => {
      for (let index = 0; index < 400; index++) {
        await settleStoreRound(index);
      }
    }, 7_000_000);
  });

  it("flattens retained heap across repeated async store rounds", async () => {
    const samples = await collectHeapSamples(8, async (round) => {
      for (let index = 0; index < 40; index++) {
        await settleStoreRound(round * 1_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 4_000_000,
      maxLastDeltaBytes: 700_000,
      maxTailHeadRatio: 1.8,
    });
  });

  it("persistent store stays heap-bounded with unique query-key accumulation", async () => {
    // Unlike settleStoreRound (which creates a new store per round), this test
    // uses a single long-lived store and exercises the accumulation pattern
    // that a real app would see.
    await expectRetainedHeapBudget(async () => {
      const { store, docCalls, queryCalls } = createAsyncStore();

      for (let round = 0; round < 40; round++) {
        // Each round uses a new workspaceId — new query keys accumulate in the bucket
        store.findQuery("dashboard", { workspaceId: round, active: true });
        store.find("user", String(round));

        await flushFinder();

        for (const call of docCalls.splice(0)) {
          if (round % 3 === 0) {
            call.deferred.reject(new Error("round-error"));
          } else {
            call.deferred.resolve(call.ids.map((id, i) => makeUser(id, round + i)));
          }
        }
        for (const call of queryCalls.splice(0)) {
          if (round % 5 === 0) {
            call.deferred.reject(new Error("query-error"));
          } else {
            call.deferred.resolve(call.paramsList.map((p, i) => makeDashboard(p, round + i)));
          }
        }
        await delay(5);

        if (round % 10 === 9) {
          store.clearMemory();
        }
      }

      // Final cleanup
      store.clearMemory();
      await delay(10);
    }, 4_500_000);
  });
});
