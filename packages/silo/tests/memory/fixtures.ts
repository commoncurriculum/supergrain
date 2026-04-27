import { delay } from "@supergrain/test-utils/memory";

import { createDocumentStore } from "../../src";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface UserDoc {
  id: string;
  name: string;
  payload: Array<number>;
}

export interface DashboardParams {
  workspaceId: number;
  active: boolean;
}

export interface DashboardResult {
  total: number;
  ids: Array<string>;
  payload: Array<number>;
}

export type Models = {
  user: UserDoc;
};

export type Queries = {
  dashboard: {
    params: DashboardParams;
    result: DashboardResult;
  };
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function makeUser(id: string, seed: number): UserDoc {
  return {
    id,
    name: `User-${seed}-${id}`,
    payload: Array.from({ length: 18 }, (_, index) => seed + index),
  };
}

export function makeDashboard(params: DashboardParams, seed: number): DashboardResult {
  return {
    total: params.workspaceId * 10 + seed,
    ids: [`${params.workspaceId}-1`, `${params.workspaceId}-2`],
    payload: Array.from({ length: 24 }, (_, index) => seed + index),
  };
}

export interface AsyncDocCall {
  ids: Array<string>;
  deferred: Deferred<Array<UserDoc>>;
}

export interface AsyncQueryCall {
  paramsList: Array<DashboardParams>;
  deferred: Deferred<Array<DashboardResult>>;
}

export function createAsyncStore() {
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

export async function flushFinder(): Promise<void> {
  await delay(10);
  await Promise.resolve();
}

export async function settleStoreRound(seed: number): Promise<void> {
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
