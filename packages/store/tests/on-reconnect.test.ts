import type { QueryAdapter } from "../src";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { advance, flushCoalescer, makeStore } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// onReconnect — docs
// =============================================================================

describe("onReconnect (docs)", () => {
  it("refetches all currently-acquired docs, batched by type", async () => {
    const subscribeDoc = vi.fn(() => () => {});
    const { store, userAdapter } = makeStore({ subscribeDoc });

    store.findDoc("user", "1");
    store.findDoc("user", "2");
    store.acquireDoc("user", "1");
    store.acquireDoc("user", "2");
    await flushCoalescer();
    expect(userAdapter.find).toHaveBeenCalledTimes(1);

    store.onReconnect();
    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(2);
    const secondCallIds = (userAdapter.find as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as string[];
    expect(secondCallIds).toEqual(expect.arrayContaining(["1", "2"]));
  });

  it("does not refetch docs that were findDoc'd but never acquired", async () => {
    const { store, userAdapter } = makeStore();

    store.findDoc("user", "1");
    await flushCoalescer();
    expect(userAdapter.find).toHaveBeenCalledTimes(1);

    store.onReconnect();
    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
  });

  it("does not refetch docs whose refcount has returned to zero past the grace period", async () => {
    const { store, userAdapter } = makeStore({ keepAliveMs: 0 });

    const release = store.acquireDoc("user", "1");
    await flushCoalescer();
    expect(userAdapter.find).toHaveBeenCalledTimes(1);

    release();
    await advance(1);

    store.onReconnect();
    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// onReconnect — queries
// =============================================================================

describe("onReconnect (queries)", () => {
  it("refetches all currently-acquired queries", async () => {
    const feedAdapter: QueryAdapter = {
      fetch: vi.fn(async () => ({
        data: [],
        included: [],
        nextOffset: null,
      })),
    };
    const { store } = makeStore({
      queries: { "activity-feed": feedAdapter },
    });

    const def = { type: "activity-feed", id: "u1" };
    store.query(def);
    store.acquireQuery(def);
    await flushCoalescer();
    expect(feedAdapter.fetch).toHaveBeenCalledTimes(1);

    store.onReconnect();
    await flushCoalescer();

    expect(feedAdapter.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not refetch queries that were query()'d but never acquired", async () => {
    const feedAdapter: QueryAdapter = {
      fetch: vi.fn(async () => ({
        data: [],
        included: [],
        nextOffset: null,
      })),
    };
    const { store } = makeStore({
      queries: { "activity-feed": feedAdapter },
    });

    store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();
    expect(feedAdapter.fetch).toHaveBeenCalledTimes(1);

    store.onReconnect();
    await flushCoalescer();

    expect(feedAdapter.fetch).toHaveBeenCalledTimes(1);
  });
});
