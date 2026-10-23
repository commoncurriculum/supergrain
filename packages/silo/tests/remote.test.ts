import { effect } from "@supergrain/kernel";
import { Schedule } from "effect";
import { describe, expect, it } from "vitest";

import {
  AdapterError,
  createRemoteQueryStore,
  remoteQuery,
  type RemoteQueryStoreConfig,
} from "../src";

interface Body {
  groupId: number;
  filters: { standardSetId: string } | null;
}

interface Summary {
  groupId: number;
  totals: Array<number>;
}

interface Request {
  path: string;
}

const summaryQuery = remoteQuery<Body, Summary, Request>("summary", { path: "/summary" });
const otherQuery = remoteQuery<Body, Summary, Request>("other", { path: "/other" });

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function makeServer() {
  const totals = new Map<number, Array<number>>();
  const requests: Array<number> = [];
  let failing = false;
  const fetch: RemoteQueryStoreConfig<Request>["fetch"] = async (_request, params) => {
    const { groupId } = params as Body;
    requests.push(groupId);
    await wait(5);
    if (failing) throw new Error("500");
    return { groupId, totals: totals.get(groupId) ?? [1, 2] } satisfies Summary;
  };
  return {
    fetch,
    setTotals: (groupId: number, values: Array<number>) => totals.set(groupId, values),
    fail: (value: boolean) => {
      failing = value;
    },
    count: (groupId: number) => requests.filter((id) => id === groupId).length,
  };
}

function body(groupId: number, filters: Body["filters"] = null): Body {
  return { groupId, filters };
}

describe("RemoteQueryStore.fetch", () => {
  it("shares a fetch in flight, returns the cached result while fresh, and rejects on failure", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({
      fetch: server.fetch,
      staleTime: Infinity,
      retry: Schedule.recurs(0),
    });

    const [first, concurrent] = await Promise.all([
      store.fetch(summaryQuery, body(1)),
      store.fetch(summaryQuery, body(1)),
    ]);
    const second = await store.fetch(summaryQuery, body(1));
    expect(first.totals).toEqual([1, 2]);
    expect(concurrent).toBe(first);
    expect(second).toBe(first);
    expect(server.count(1)).toBe(1);

    server.fail(true);
    store.invalidate(summaryQuery);
    await expect(store.fetch(summaryQuery, body(1))).rejects.toBeInstanceOf(AdapterError);
    expect(server.count(1)).toBe(2);
  });

  it("keeps only the newest result when a fetch is superseded", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch });
    const handle = store.find(summaryQuery, body(1));

    server.setTotals(1, [7, 8]);
    const superseded = handle.refetch();
    await wait(1);
    server.setTotals(1, [9, 9]);
    void handle.refetch();
    await superseded;

    expect(handle.value?.totals).toEqual([9, 9]);
    expect(handle.isFetching).toBe(false);
    expect(server.count(1)).toBe(3);
  });
});

describe("RemoteQueryStore.find", () => {
  it("returns an idle handle without fetching when params are null", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch });

    const handle = store.find(summaryQuery, null);
    await handle.refetch();

    expect(handle.status).toBe("pending");
    expect(handle.value).toBeUndefined();
    expect(server.count(1)).toBe(0);
  });

  it("keeps a result forever with an infinite gcTime", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({
      fetch: server.fetch,
      staleTime: Infinity,
      gcTime: Infinity,
    });

    store.observe(summaryQuery, body(1))();
    await wait(20);

    expect(store.find(summaryQuery, body(1)).value?.groupId).toBe(1);
    expect(server.count(1)).toBe(1);
  });

  it("fails the handle with reason 'defect' when a subscriber throws as the result lands", async () => {
    const server = makeServer();
    const reasons: Array<AdapterError["reason"]> = [];
    const store = createRemoteQueryStore<Request>({
      fetch: server.fetch,
      onError: (error) => {
        if (error instanceof AdapterError) reasons.push(error.reason);
      },
    });

    const handle = store.find(summaryQuery, body(1));
    let threw = false;
    const dispose = effect(() => {
      if (handle.value !== undefined && !threw) {
        threw = true;
        throw new Error("subscriber bug");
      }
    });
    await wait(20);

    expect((handle.error as AdapterError).reason).toBe("defect");
    expect(handle.isFetching).toBe(false);
    expect(reasons).toEqual(["defect"]);
    dispose();
  });
});

describe("RemoteQueryStore.invalidate", () => {
  it("matches partial params at every depth and ignores queries never loaded", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch, staleTime: Infinity });
    const unfiltered = store.find(summaryQuery, body(1));
    const filtered = store.find(summaryQuery, body(2, { standardSetId: "math" }));
    await wait(20);

    store.invalidate(otherQuery);
    store.invalidate(summaryQuery, { filters: { standardSetId: "math" } });

    expect(unfiltered.isStale).toBe(false);
    expect(filtered.isStale).toBe(true);
  });
});
