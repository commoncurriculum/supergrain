import type { SubscribeDocFn } from "../src";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { advance, flushCoalescer, makeFeedAdapter, makeStore } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// acquireDoc — side-effect separation
// =============================================================================

describe("acquireDoc separation from findDoc", () => {
  it("findDoc alone does NOT call subscribeDoc", async () => {
    const subscribeDoc = vi.fn(() => () => {});
    const { store } = makeStore({ subscribeDoc });

    store.findDoc("user", "1");
    await flushCoalescer();

    expect(subscribeDoc).not.toHaveBeenCalled();
  });

  it("acquireDoc alone (without a prior findDoc) triggers a batched fetch", async () => {
    // Pins the contract: acquireDoc is sufficient on its own to start
    // the data flow. A React hook that only calls acquireDoc on mount
    // would still get data — findDoc on every render is an optimization
    // for stable identity, not a fetch-triggering requirement.
    const { store, userAdapter } = makeStore();

    store.acquireDoc("user", "1");
    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
    expect(userAdapter.find).toHaveBeenCalledWith(["1"]);
  });
});

// =============================================================================
// acquireDoc — refcount semantics
// =============================================================================

describe("acquireDoc refcount", () => {
  it("calls subscribeDoc on the first acquire (refcount 0 → 1)", () => {
    const subscribeDoc = vi.fn(() => () => {});
    const { store } = makeStore({ subscribeDoc });

    store.acquireDoc("user", "1");

    expect(subscribeDoc).toHaveBeenCalledTimes(1);
    expect(subscribeDoc).toHaveBeenCalledWith("user", "1", expect.any(Function));
  });

  it("does NOT call subscribeDoc again on a second acquire for the same doc", () => {
    const subscribeDoc = vi.fn(() => () => {});
    const { store } = makeStore({ subscribeDoc });

    store.acquireDoc("user", "1");
    store.acquireDoc("user", "1");

    expect(subscribeDoc).toHaveBeenCalledTimes(1);
  });

  it("only tears down when ALL acquirers have released", async () => {
    const unsubscribe = vi.fn();
    const subscribeDoc = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 0,
    });

    const release1 = store.acquireDoc("user", "1");
    const release2 = store.acquireDoc("user", "1");

    release1();
    await advance(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    release2();
    await advance(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("refetches the doc when the server fires invalidation on an acquired doc", async () => {
    let invalidate: (() => void) | undefined;
    const subscribeDoc = vi.fn((_type, _id, onInvalidate) => {
      invalidate = onInvalidate;
      return () => {};
    });

    const { store, userAdapter } = makeStore({ subscribeDoc });
    const doc = store.findDoc("user", "1");
    store.acquireDoc("user", "1");
    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);

    invalidate!();

    // isPending must stay false across invalidation-triggered refetch
    expect(doc.isPending).toBe(false);
    expect(doc.isFetching).toBe(true);

    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(2);
    expect(doc.isFetching).toBe(false);
  });
});

// =============================================================================
// acquireDoc — grace period
// =============================================================================

describe("acquireDoc grace period", () => {
  it("release does NOT immediately unsubscribe", () => {
    const unsubscribe = vi.fn();
    const subscribeDoc = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 100,
    });

    const release = store.acquireDoc("user", "1");
    expect(subscribeDoc).toHaveBeenCalledTimes(1);

    release();

    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("tears down exactly at the keepAliveMs boundary", async () => {
    const unsubscribe = vi.fn();
    const subscribeDoc = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 50,
    });

    const release = store.acquireDoc("user", "1");
    release();

    await advance(49);
    expect(unsubscribe).not.toHaveBeenCalled();

    await advance(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("cancels the teardown timer if a new acquire happens within the grace period", async () => {
    const unsubscribe = vi.fn();
    const subscribeDoc = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 50,
    });

    const release1 = store.acquireDoc("user", "1");
    release1();

    await advance(10);
    store.acquireDoc("user", "1");

    await advance(60);

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(subscribeDoc).toHaveBeenCalledTimes(1); // never resubscribed
  });

  it("per-acquire keepAliveMs override takes precedence over config default", async () => {
    const unsubscribe = vi.fn();
    const subscribeDoc = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 10_000, // large default
    });

    const release = store.acquireDoc("user", "1", { keepAliveMs: 10 });
    release();

    await advance(11);

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("keepAliveMs: 0 schedules teardown on the next microtask, not synchronously", async () => {
    const unsubscribe = vi.fn();
    const subscribeDoc = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 0,
    });

    const release = store.acquireDoc("user", "1");
    release();

    // Synchronously, nothing has happened yet
    expect(unsubscribe).not.toHaveBeenCalled();

    await advance(0);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keepAliveMs: 0 — a synchronous re-acquire after release cancels teardown", async () => {
    // Critical for React StrictMode: release() schedules setTimeout(0),
    // and a synchronous re-acquire in the same tick must cancel it.
    // An implementation that used queueMicrotask could race and lose;
    // this test pins the cancellation path at the 0ms boundary.
    const unsubscribe = vi.fn();
    const subscribeDoc = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 0,
    });

    const release1 = store.acquireDoc("user", "1");
    release1();
    // Synchronously re-acquire — no await between release and acquire
    const release2 = store.acquireDoc("user", "1");

    await advance(1);

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(subscribeDoc).toHaveBeenCalledTimes(1);

    // And proper teardown still works on the final release
    release2();
    await advance(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// acquireDoc — array inputs
// =============================================================================

describe("acquireDoc with array input", () => {
  it("acquires every id individually (one subscribeDoc per id)", () => {
    const subscribeDoc: SubscribeDocFn = vi.fn(() => () => {});
    const { store } = makeStore({ subscribeDoc });

    store.acquireDoc("user", ["1", "2", "3"]);

    expect(subscribeDoc).toHaveBeenCalledTimes(3);
    const calledIds = (subscribeDoc as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[1] as string,
    );
    expect(calledIds).toEqual(expect.arrayContaining(["1", "2", "3"]));
  });

  it("returns a release fn that decrements every id's refcount", async () => {
    const unsubscribe = vi.fn();
    const subscribeDoc = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 0,
    });

    const release = store.acquireDoc("user", ["1", "2", "3"]);
    release();
    await advance(1);

    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });

  it("respects overlapping per-id refcounts", async () => {
    const unsubscribeById = new Map<string, ReturnType<typeof vi.fn>>();
    const subscribeDoc = vi.fn((_type, id) => {
      const fn = vi.fn();
      unsubscribeById.set(id, fn);
      return fn;
    });
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 0,
    });

    // First, acquire user:1 alone → refcount user:1 = 1
    const release1 = store.acquireDoc("user", "1");
    // Then, acquire user:1 AND user:2 → refcount user:1 = 2, user:2 = 1
    const release2 = store.acquireDoc("user", ["1", "2"]);

    // Release the array acquire: user:1 = 1, user:2 = 0
    release2();
    await advance(1);

    expect(unsubscribeById.get("1")).not.toHaveBeenCalled();
    expect(unsubscribeById.get("2")).toHaveBeenCalledTimes(1);

    // Release the first acquire: user:1 = 0
    release1();
    await advance(1);

    expect(unsubscribeById.get("1")).toHaveBeenCalledTimes(1);
  });

  it("returns a no-op release when the array is null", () => {
    const subscribeDoc = vi.fn(() => () => {});
    const { store } = makeStore({ subscribeDoc });

    const release = store.acquireDoc("user", null);
    expect(subscribeDoc).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });

  it("returns a no-op release when the array is empty", () => {
    const subscribeDoc = vi.fn(() => () => {});
    const { store } = makeStore({ subscribeDoc });

    const release = store.acquireDoc("user", []);
    expect(subscribeDoc).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });

  it("dedupes duplicate ids within a single array input", async () => {
    // `acquireDoc("user", ["1", "1", "2"])` must be equivalent to
    // `acquireDoc("user", ["1", "2"])`: one subscribe per unique id,
    // and a single release() drives each unique id's refcount back
    // to zero. An implementation that counted each occurrence would
    // require TWO release calls on "1" to tear down — that's wrong.
    const unsubscribeById = new Map<string, ReturnType<typeof vi.fn>>();
    const subscribeDoc = vi.fn((_type, id) => {
      const fn = vi.fn();
      unsubscribeById.set(id, fn);
      return fn;
    });
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 0,
    });

    const release = store.acquireDoc("user", ["1", "1", "2"]);

    // Exactly one subscribe per unique id
    expect(subscribeDoc).toHaveBeenCalledTimes(2);
    const subscribedIds = (subscribeDoc as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[1] as string,
    );
    expect(subscribedIds.sort()).toEqual(["1", "2"]);

    // Single release drives both back to zero — no stuck refcount on "1"
    release();
    await advance(1);

    expect(unsubscribeById.get("1")).toHaveBeenCalledTimes(1);
    expect(unsubscribeById.get("2")).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// acquireDoc — idempotent release
// =============================================================================

describe("acquireDoc release idempotency", () => {
  it("calling release more than once is a no-op on subsequent calls", async () => {
    // A second release() call must NOT double-decrement the refcount.
    // If it did, a later legitimate release from another acquirer would
    // drive the count negative and tear down a still-held subscription.
    const unsubscribe = vi.fn();
    const subscribeDoc = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      subscribeDoc,
      keepAliveMs: 0,
    });

    const releaseA = store.acquireDoc("user", "1");
    const releaseB = store.acquireDoc("user", "1");

    // Oops — caller releases A twice
    releaseA();
    releaseA();
    await advance(1);

    // Still held by B; no teardown
    expect(unsubscribe).not.toHaveBeenCalled();

    // Real teardown when B releases
    releaseB();
    await advance(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// acquireDoc — null handling
// =============================================================================

describe("acquireDoc null handling", () => {
  it("returns a no-op release when id is null", () => {
    const subscribeDoc = vi.fn(() => () => {});
    const { store } = makeStore({ subscribeDoc });

    const release = store.acquireDoc("user", null);
    expect(subscribeDoc).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });

  it("returns a no-op release when id is undefined", () => {
    const subscribeDoc = vi.fn(() => () => {});
    const { store } = makeStore({ subscribeDoc });

    const release = store.acquireDoc("user", undefined);
    expect(subscribeDoc).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });
});

// =============================================================================
// acquireQuery
// =============================================================================

describe("acquireQuery", () => {
  it("query() alone does NOT call subscribeQuery", async () => {
    const subscribeQuery = vi.fn(() => () => {});
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
      subscribeQuery,
    });

    store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    expect(subscribeQuery).not.toHaveBeenCalled();
  });

  it("calls subscribeQuery on the first acquire", () => {
    const subscribeQuery = vi.fn(() => () => {});
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
      subscribeQuery,
    });

    const def = { type: "activity-feed", id: "u1" };
    store.acquireQuery(def);

    expect(subscribeQuery).toHaveBeenCalledWith(
      expect.objectContaining({ type: "activity-feed", id: "u1" }),
      expect.any(Function),
    );
  });

  it("refetches the query when server-pushed invalidation fires", async () => {
    let invalidate: (() => void) | undefined;
    const subscribeQuery = vi.fn((_def, onInvalidate) => {
      invalidate = onInvalidate;
      return () => {};
    });
    const feed = makeFeedAdapter();
    const { store } = makeStore({
      queries: { "activity-feed": feed },
      subscribeQuery,
    });

    const def = { type: "activity-feed", id: "u1" };
    const q = store.query(def);
    store.acquireQuery(def);
    await flushCoalescer();
    expect(feed.fetch).toHaveBeenCalledTimes(1);

    invalidate!();
    expect(q.isPending).toBe(false);
    expect(q.isFetching).toBe(true);

    await flushCoalescer();
    expect(feed.fetch).toHaveBeenCalledTimes(2);
    expect(q.isFetching).toBe(false);
  });

  it("only tears down when all acquirers have released (refcount semantics)", async () => {
    const unsubscribe = vi.fn();
    const subscribeQuery = vi.fn(() => unsubscribe);
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
      subscribeQuery,
      keepAliveMs: 0,
    });

    const def = { type: "activity-feed", id: "u1" };
    const release1 = store.acquireQuery(def);
    const release2 = store.acquireQuery(def);

    expect(subscribeQuery).toHaveBeenCalledTimes(1);

    release1();
    await advance(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    release2();
    await advance(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("returns a no-op release when def is null", () => {
    const subscribeQuery = vi.fn(() => () => {});
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
      subscribeQuery,
    });

    const release = store.acquireQuery(null);
    expect(subscribeQuery).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });

  it("returns a no-op release when def is undefined", () => {
    const subscribeQuery = vi.fn(() => () => {});
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
      subscribeQuery,
    });

    const release = store.acquireQuery(undefined);
    expect(subscribeQuery).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });
});
