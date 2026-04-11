import type { DocumentAdapter, QueryAdapter, StoreEvent } from "../src";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { type User, flushCoalescer, makeFeedAdapter, makePostAdapter, makeStore } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function eventsOfKind(listener: ReturnType<typeof vi.fn>, kind: StoreEvent["kind"]): StoreEvent[] {
  return listener.mock.calls.map((c) => c[0] as StoreEvent).filter((e) => e.kind === kind);
}

// =============================================================================
// store.subscribe — document events
// =============================================================================

describe("store.subscribe doc events", () => {
  it("emits doc-fetch-start and doc-fetch-success with the full payload", async () => {
    const listener = vi.fn();
    const { store } = makeStore();
    store.subscribe(listener);

    store.findDoc("user", "1");
    await flushCoalescer();

    const starts = eventsOfKind(listener, "doc-fetch-start");
    const successes = eventsOfKind(listener, "doc-fetch-success");

    expect(starts).toHaveLength(1);
    expect(starts[0]).toEqual({
      kind: "doc-fetch-start",
      type: "user",
      ids: ["1"],
    });

    expect(successes).toHaveLength(1);
    expect(successes[0]).toEqual({
      kind: "doc-fetch-success",
      type: "user",
      ids: ["1"],
    });
  });

  it("emits doc-fetch-error with the thrown error", async () => {
    const failingAdapter: DocumentAdapter<User> = {
      find: vi.fn(async () => {
        throw new Error("nope");
      }),
    };
    const listener = vi.fn();
    const { store } = makeStore({
      adapters: { user: failingAdapter, post: makePostAdapter() },
    });
    store.subscribe(listener);

    store.findDoc("user", "1");
    await flushCoalescer();

    const errors = eventsOfKind(listener, "doc-fetch-error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      kind: "doc-fetch-error",
      type: "user",
      ids: ["1"],
    });
    expect((errors[0] as { error: Error }).error).toBeInstanceOf(Error);
    expect((errors[0] as { error: Error }).error.message).toBe("nope");
  });

  it("emits doc-insert when insertDocument is called directly", () => {
    const listener = vi.fn();
    const { store } = makeStore();
    store.subscribe(listener);

    store.insertDocument({
      type: "user",
      id: "1",
      attributes: { firstName: "X", lastName: "Y", email: "x@y" },
    });

    const inserts = eventsOfKind(listener, "doc-insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({
      kind: "doc-insert",
      type: "user",
      id: "1",
    });
  });

  it("emits invalidate-doc when an acquired doc's live subscription fires", async () => {
    let invalidate: (() => void) | undefined;
    const subscribeDoc = vi.fn((_type, _id, onInvalidate) => {
      invalidate = onInvalidate;
      return () => {};
    });
    const { store } = makeStore({ subscribeDoc });
    const listener = vi.fn();
    store.subscribe(listener);

    store.findDoc("user", "1");
    store.acquireDoc("user", "1");
    await flushCoalescer();

    invalidate!();

    const invalidations = eventsOfKind(listener, "invalidate-doc");
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0]).toEqual({
      kind: "invalidate-doc",
      type: "user",
      id: "1",
    });
  });
});

// =============================================================================
// store.subscribe — query events
// =============================================================================

describe("store.subscribe query events", () => {
  it("emits query-fetch-start and query-fetch-success", async () => {
    const listener = vi.fn();
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });
    store.subscribe(listener);

    store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    const starts = eventsOfKind(listener, "query-fetch-start");
    const successes = eventsOfKind(listener, "query-fetch-success");

    expect(starts).toHaveLength(1);
    expect(typeof (starts[0] as { key: string }).key).toBe("string");
    expect(successes).toHaveLength(1);
    expect(typeof (successes[0] as { key: string }).key).toBe("string");
  });

  it("emits query-fetch-error when the query adapter throws", async () => {
    const failing: QueryAdapter = {
      fetch: vi.fn(async () => {
        throw new Error("feed boom");
      }),
    };
    const listener = vi.fn();
    const { store } = makeStore({
      queries: { "activity-feed": failing },
    });
    store.subscribe(listener);

    store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    const errors = eventsOfKind(listener, "query-fetch-error");
    expect(errors).toHaveLength(1);
    expect((errors[0] as { error: Error }).error.message).toBe("feed boom");
  });

  it("emits invalidate-query when an acquired query's subscription fires", async () => {
    let invalidate: (() => void) | undefined;
    const subscribeQuery = vi.fn((_def, onInvalidate) => {
      invalidate = onInvalidate;
      return () => {};
    });
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
      subscribeQuery,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    const def = { type: "activity-feed", id: "u1" };
    store.query(def);
    store.acquireQuery(def);
    await flushCoalescer();

    invalidate!();

    const invalidations = eventsOfKind(listener, "invalidate-query");
    expect(invalidations).toHaveLength(1);
    expect(typeof (invalidations[0] as { key: string }).key).toBe("string");
  });
});

// =============================================================================
// store.subscribe — unsubscribe
// =============================================================================

describe("store.subscribe unsubscribe", () => {
  it("returns an unsubscribe function that stops further events", async () => {
    const listener = vi.fn();
    const { store } = makeStore();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();

    store.findDoc("user", "1");
    await flushCoalescer();

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple independent subscribers", async () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const { store } = makeStore();

    store.subscribe(listenerA);
    store.subscribe(listenerB);

    store.findDoc("user", "1");
    await flushCoalescer();

    expect(listenerA).toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalled();
  });
});
