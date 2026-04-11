import type { DocumentAdapter, DocumentResponse, QueryAdapter } from "../src";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { advance, flushCoalescer, makePostAdapter, makeStore, type User } from "./helpers";

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

// =============================================================================
// onReconnect — interaction with in-flight fetch
// =============================================================================

describe("onReconnect during in-flight fetch", () => {
  it("dispatches a fresh fetch even when a prior fetch is still in flight", async () => {
    // Scenario: acquired doc is mid-fetch when the socket reconnects.
    // onReconnect must issue a fresh batched fetch. The pre-reconnect
    // response is superseded when it eventually resolves.
    let resolveFirst: (() => void) | undefined;
    let callIndex = 0;
    const userFind = vi.fn((ids: string[]): Promise<DocumentResponse<User>> => {
      const index = callIndex++;
      return new Promise((resolve) => {
        const doResolve = () =>
          resolve({
            data: ids.map((id) => ({
              type: "user",
              id,
              attributes: {
                firstName: index === 0 ? "Stale" : "Fresh",
                lastName: "X",
                email: "x@y",
              },
              meta: { revision: index + 1 },
            })),
          });
        if (index === 0) {
          resolveFirst = doResolve;
        } else {
          doResolve();
        }
      });
    });
    const userAdapter: DocumentAdapter<User> = { find: userFind };
    const { store } = makeStore({
      adapters: { user: userAdapter, post: makePostAdapter() },
    });

    store.acquireDoc("user", "1");
    await advance(20);
    expect(userFind).toHaveBeenCalledTimes(1);

    // Reconnect BEFORE the first fetch resolves
    store.onReconnect();
    await advance(20);

    // A second fetch must have been dispatched — onReconnect is not a
    // no-op just because a fetch is already in flight.
    expect(userFind).toHaveBeenCalledTimes(2);

    // Drain the stale first fetch; it must not clobber the fresh result.
    resolveFirst!();
    await vi.runAllTimersAsync();
  });
});
