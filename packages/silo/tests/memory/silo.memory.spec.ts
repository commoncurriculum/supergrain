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

import { createDocumentStore } from "../../src";

// Always-run sentinel: ensures the memory config actually exposed GC.
it("GC is exposed (required for all silo memory tests)", () => {
  assertGcAvailable();
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface UserDoc {
  id: string;
  name: string;
  payload: Array<number>;
}

interface DashboardParams {
  workspaceId: number;
  active: boolean;
}

interface DashboardResult {
  total: number;
  ids: Array<string>;
  payload: Array<number>;
}

type Models = {
  user: UserDoc;
};

type Queries = {
  dashboard: {
    params: DashboardParams;
    result: DashboardResult;
  };
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeUser(id: string, seed: number): UserDoc {
  return {
    id,
    name: `User-${seed}-${id}`,
    payload: Array.from({ length: 18 }, (_, index) => seed + index),
  };
}

function makeDashboard(params: DashboardParams, seed: number): DashboardResult {
  return {
    total: params.workspaceId * 10 + seed,
    ids: [`${params.workspaceId}-1`, `${params.workspaceId}-2`],
    payload: Array.from({ length: 24 }, (_, index) => seed + index),
  };
}

interface AsyncDocCall {
  ids: Array<string>;
  deferred: Deferred<Array<UserDoc>>;
}

interface AsyncQueryCall {
  paramsList: Array<DashboardParams>;
  deferred: Deferred<Array<DashboardResult>>;
}

function createAsyncStore() {
  const docCalls: Array<AsyncDocCall> = [];
  const queryCalls: Array<AsyncQueryCall> = [];

  const store = createDocumentStore<Models, Queries>({
    models: {
      user: {
        adapter: {
          async find(ids) {
            const run = deferred<Array<UserDoc>>();
            docCalls.push({ ids: [...ids], deferred: run });
            return run.promise;
          },
        },
      },
    },
    queries: {
      dashboard: {
        adapter: {
          async find(paramsList) {
            const run = deferred<Array<DashboardResult>>();
            queryCalls.push({ paramsList: [...paramsList], deferred: run });
            return run.promise;
          },
        },
      },
    },
    batchWindowMs: 1,
    batchSize: 3,
  });

  return { store, docCalls, queryCalls };
}

async function flushFinder(): Promise<void> {
  await delay(10);
  await Promise.resolve();
}

async function settleStoreRound(seed: number): Promise<void> {
  const { store, docCalls, queryCalls } = createAsyncStore();

  const userA = store.find("user", "1");
  const userB = store.find("user", "1");
  const userC = store.find("user", "2");
  const userD = store.find("user", "3");

  const dashboardA = store.findQuery("dashboard", { workspaceId: seed, active: true });
  const dashboardB = store.findQuery("dashboard", { workspaceId: seed, active: true });
  const dashboardC = store.findQuery("dashboard", { workspaceId: seed + 1, active: true });

  void userA;
  void userB;
  void dashboardA;
  void dashboardB;

  await flushFinder();
  store.clearMemory();

  for (const call of [...docCalls].reverse()) {
    if (seed % 3 === 0) {
      call.deferred.reject(new Error(`doc-failure-${seed}`));
      continue;
    }
    const docs =
      seed % 4 === 0
        ? call.ids
            .slice(0, Math.max(1, call.ids.length - 1))
            .map((id, index) => makeUser(id, seed + index))
        : call.ids.map((id, index) => makeUser(id, seed + index));
    call.deferred.resolve(docs);
  }

  for (const call of [...queryCalls].reverse()) {
    if (seed % 5 === 0) {
      call.deferred.reject(new Error(`query-failure-${seed}`));
      continue;
    }
    call.deferred.resolve(
      call.paramsList.map((params, index) => makeDashboard(params, seed + index)),
    );
  }

  await Promise.allSettled([
    userC.promise ?? Promise.resolve(undefined),
    userD.promise ?? Promise.resolve(undefined),
    dashboardC.promise ?? Promise.resolve(undefined),
    ...docCalls.map((call) => call.deferred.promise),
    ...queryCalls.map((call) => call.deferred.promise),
  ]);

  store.clearMemory();
  await delay();
}

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

describe.runIf(HAS_GC)("silo memory soak", () => {
  it("stays flat during extended async finder churn", async () => {
    const samples = await collectHeapSamples(10, async (round) => {
      for (let index = 0; index < 60; index++) {
        await settleStoreRound(round * 10_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 6_000_000,
      maxLastDeltaBytes: 900_000,
      maxTailHeadRatio: 2.0,
    });
  });
});
