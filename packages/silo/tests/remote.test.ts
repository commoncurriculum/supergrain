import { effect } from "@supergrain/kernel";
import { Schedule } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  AdapterError,
  createRemoteQueryStore,
  remoteQuery,
  type RemoteQueryStoreConfig,
} from "../src";
import { setupFakeTimers } from "./setup/timers";

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

setupFakeTimers();

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** A server that answers after 5ms. Every request is recorded, so a test can count fetches. */
function makeServer() {
  const totals = new Map<number, Array<number>>();
  const requests: Array<number> = [];
  let failing = false;
  const fetch: RemoteQueryStoreConfig<Request>["fetch"] = async (_request, params) => {
    const { groupId } = params as Body;
    requests.push(groupId);
    await new Promise((resolve) => setTimeout(resolve, 5));
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
  it("shares a fetch in flight, returns the cached result until staleTime, and rejects on failure", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({
      fetch: server.fetch,
      staleTime: 1000,
      retry: Schedule.recurs(0),
    });

    const both = Promise.all([
      store.fetch(summaryQuery, body(1)),
      store.fetch(summaryQuery, body(1)),
    ]);
    await advance(5);
    const [first, concurrent] = await both;
    const cached = await store.fetch(summaryQuery, body(1));
    expect(first.totals).toEqual([1, 2]);
    expect(concurrent).toBe(first);
    expect(cached).toBe(first);
    expect(server.count(1)).toBe(1);

    await advance(1000);
    server.fail(true);
    const failed = expect(store.fetch(summaryQuery, body(1))).rejects.toBeInstanceOf(AdapterError);
    await advance(5);
    await failed;
    expect(server.count(1)).toBe(2);
  });

  it("keeps only the newest result when a fetch is superseded", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch });
    const handle = store.find(summaryQuery, body(1));

    server.setTotals(1, [7, 8]);
    const superseded = handle.refetch();
    await advance(1);
    server.setTotals(1, [9, 9]);
    void handle.refetch();
    await advance(5);
    await superseded;

    expect(handle.value?.totals).toEqual([9, 9]);
    expect(handle.isFetching).toBe(false);
    expect(server.count(1)).toBe(3);
  });
});

describe("RemoteQueryStore.observe", () => {
  it("decides staleness per observer, from its own staleTime", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch, staleTime: 60_000 });

    const first = store.observe(summaryQuery, body(1));
    await advance(10_000);
    expect(server.count(1)).toBe(1);

    const eager = store.observe(summaryQuery, body(1), { staleTime: 0 });
    await advance(5);
    expect(server.count(1)).toBe(2);

    const patient = store.observe(summaryQuery, body(1), { staleTime: Infinity });
    await advance(5);
    expect(server.count(1)).toBe(2);

    first();
    eager();
    patient();
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

  it("drops an unobserved result gcTime after its last fetch, or never with an infinite gcTime", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch, gcTime: 100 });
    const forever = createRemoteQueryStore<Request>({ fetch: server.fetch, gcTime: Infinity });

    const handle = store.find(summaryQuery, body(1));
    await advance(95);
    void handle.refetch();
    await advance(95);
    expect(store.find(summaryQuery, body(1))).toBe(handle);

    await advance(20);
    expect(store.find(summaryQuery, body(1))).not.toBe(handle);

    forever.observe(summaryQuery, body(2))();
    await advance(60_000);
    expect(forever.find(summaryQuery, body(2)).value?.groupId).toBe(2);
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
    await advance(5);

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
    store.find(summaryQuery, body(1));
    store.find(summaryQuery, body(2, { standardSetId: "math" }));
    await advance(5);

    store.invalidate(otherQuery);
    store.invalidate(summaryQuery, { filters: { standardSetId: "math" } });
    const results = Promise.all([
      store.fetch(summaryQuery, body(1)),
      store.fetch(summaryQuery, body(2, { standardSetId: "math" })),
    ]);
    await advance(5);
    await results;

    expect([server.count(1), server.count(2)]).toEqual([1, 2]);
  });
});
