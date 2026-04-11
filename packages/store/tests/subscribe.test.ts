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

    const starts = eventsOfKind(listener, "DOC_FETCH_START");
    const successes = eventsOfKind(listener, "DOC_FETCH_SUCCESS");

    expect(starts).toHaveLength(1);
    expect(starts[0]).toEqual({
      kind: "DOC_FETCH_START",
      type: "user",
      ids: ["1"],
    });

    expect(successes).toHaveLength(1);
    expect(successes[0]).toEqual({
      kind: "DOC_FETCH_SUCCESS",
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

    const errors = eventsOfKind(listener, "DOC_FETCH_ERROR");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      kind: "DOC_FETCH_ERROR",
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

    const inserts = eventsOfKind(listener, "DOC_INSERT");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({
      kind: "DOC_INSERT",
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

    const invalidations = eventsOfKind(listener, "INVALIDATE_DOC");
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0]).toEqual({
      kind: "INVALIDATE_DOC",
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

    const starts = eventsOfKind(listener, "QUERY_FETCH_START");
    const successes = eventsOfKind(listener, "QUERY_FETCH_SUCCESS");

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

    const errors = eventsOfKind(listener, "QUERY_FETCH_ERROR");
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

    const invalidations = eventsOfKind(listener, "INVALIDATE_QUERY");
    expect(invalidations).toHaveLength(1);
    expect(typeof (invalidations[0] as { key: string }).key).toBe("string");
  });
});

// =============================================================================
// store.subscribe — connection events
// =============================================================================

describe("store.subscribe connection events", () => {
  it("emits CONNECTION_CHANGE with the new status AND the previous status", () => {
    const listener = vi.fn();
    const { store } = makeStore();
    store.subscribe(listener);

    store.setConnection("OFFLINE");

    const events = eventsOfKind(listener, "CONNECTION_CHANGE");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: "CONNECTION_CHANGE",
      status: "OFFLINE",
      previous: "ONLINE",
    });
  });

  it("emits one CONNECTION_CHANGE per distinct transition with correct previous values", () => {
    const listener = vi.fn();
    const { store } = makeStore();
    store.subscribe(listener);

    store.setConnection("OFFLINE");
    store.setConnection("DEGRADED");
    store.setConnection("ONLINE");

    const events = eventsOfKind(listener, "CONNECTION_CHANGE") as Array<{
      status: string;
      previous: string;
    }>;
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual(expect.objectContaining({ status: "OFFLINE", previous: "ONLINE" }));
    expect(events[1]).toEqual(expect.objectContaining({ status: "DEGRADED", previous: "OFFLINE" }));
    expect(events[2]).toEqual(expect.objectContaining({ status: "ONLINE", previous: "DEGRADED" }));
  });

  it("does NOT emit CONNECTION_CHANGE when setConnection is called with the current status", () => {
    // No-op dedup: calling setConnection with the same status as the
    // current value must not emit an event. This keeps the reactive
    // graph from churning on redundant transport heartbeats.
    const listener = vi.fn();
    const { store } = makeStore();
    store.subscribe(listener);

    store.setConnection("ONLINE"); // same as default
    expect(eventsOfKind(listener, "CONNECTION_CHANGE")).toHaveLength(0);

    store.setConnection("OFFLINE");
    store.setConnection("OFFLINE"); // redundant
    expect(eventsOfKind(listener, "CONNECTION_CHANGE")).toHaveLength(1);
  });

  it("supports reentrant setConnection from inside a subscribe listener", () => {
    // A listener that calls setConnection while processing an event
    // (e.g. a transport-layer integration that chains transitions)
    // must not break iteration. Both transitions must be observed,
    // in order, by every listener.
    const observed: Array<{ status: string; previous: string }> = [];
    const { store } = makeStore();
    let reentered = false;

    store.subscribe((event) => {
      if (event.kind !== "CONNECTION_CHANGE") return;
      observed.push({ status: event.status, previous: event.previous });
      if (event.status === "OFFLINE" && !reentered) {
        reentered = true;
        store.setConnection("DEGRADED");
      }
    });

    store.setConnection("OFFLINE");

    expect(observed).toEqual([
      { status: "OFFLINE", previous: "ONLINE" },
      { status: "DEGRADED", previous: "OFFLINE" },
    ]);
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
