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

  it("emits DOC_INSERT for each included doc normalized from a query response", async () => {
    // Query responses normalize `included` docs into the doc cache.
    // That normalization is a cache write — semantically identical
    // to a direct `insertDocument` — and must emit DOC_INSERT events
    // so devtools show the full cache delta, not a mystery population
    // that only QUERY_FETCH_SUCCESS hinted at.
    //
    // Order is not asserted (implementations may insert before or
    // after emitting QUERY_FETCH_SUCCESS); only that one DOC_INSERT
    // fires per included doc.
    const listener = vi.fn();
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });
    store.subscribe(listener);

    store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    const inserts = eventsOfKind(listener, "DOC_INSERT");
    const insertedIds = inserts
      .map((e) => e as { type: string; id: string })
      .filter((e) => e.type === "post")
      .map((e) => e.id)
      .sort();
    expect(insertedIds).toEqual(["10", "11"]);
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
  it("emits query-fetch-start and query-fetch-success with the SAME key", async () => {
    // Tighter than "the key is a string": a query's start and success
    // events must carry the same key so devtools can correlate them.
    // An impl that regenerated the key on each emission (e.g. from a
    // fresh object) would silently break devtools pairing.
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
    expect(successes).toHaveLength(1);
    const startKey = (starts[0] as { key: string }).key;
    const successKey = (successes[0] as { key: string }).key;
    expect(typeof startKey).toBe("string");
    expect(startKey.length).toBeGreaterThan(0);
    expect(successKey).toBe(startKey);
  });

  it("emits the same key for equivalent defs regardless of param ordering", async () => {
    // Two equivalent QueryDefs (same type/id, params with reordered
    // keys) must hash to the same event key. Pins that the devtools
    // view will correctly group them as one query, and guards the
    // handle-identity contract at the event-bus level.
    const listener = vi.fn();
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });
    store.subscribe(listener);

    store.query({
      type: "activity-feed",
      id: "u1",
      params: { a: 1, b: 2 },
    });
    store.query({
      type: "activity-feed",
      id: "u1",
      params: { b: 2, a: 1 },
    });
    await flushCoalescer();

    const starts = eventsOfKind(listener, "QUERY_FETCH_START");
    // Handle identity dedupes the second store.query call, so one
    // START event fires for the two equivalent calls.
    expect(starts).toHaveLength(1);
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

    // Invalidate key must match the START/SUCCESS key for the same
    // query — devtools pair these by key.
    const starts = eventsOfKind(listener, "QUERY_FETCH_START");
    expect(starts).toHaveLength(1);
    const startKey = (starts[0] as { key: string }).key;
    expect((invalidations[0] as { key: string }).key).toBe(startKey);
  });
});

// =============================================================================
// store.subscribe — partial-failure event routing
// =============================================================================

describe("store.subscribe partial failure", () => {
  it("emits DOC_FETCH_ERROR (not DOC_FETCH_SUCCESS) when the adapter returns a subset of requested ids", async () => {
    // The bulk handle enters ERROR state on partial failure; the
    // subscribe stream must match — devtools should see the failure,
    // not a misleading "success" event.
    const partialAdapter: DocumentAdapter<User> = {
      find: vi.fn(async (ids: string[]) => ({
        data: [
          {
            type: "user",
            id: ids[0]!,
            attributes: {
              firstName: `User${ids[0]}`,
              lastName: "X",
              email: "x@y",
            },
            meta: { revision: 1 },
          },
        ],
      })),
    };
    const listener = vi.fn();
    const { store } = makeStore({
      adapters: { user: partialAdapter, post: makePostAdapter() },
    });
    store.subscribe(listener);

    store.findDoc("user", ["1", "2", "3"]);
    await flushCoalescer();

    const successes = eventsOfKind(listener, "DOC_FETCH_SUCCESS");
    const errors = eventsOfKind(listener, "DOC_FETCH_ERROR");

    expect(successes).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      kind: "DOC_FETCH_ERROR",
      type: "user",
    });
    const err = errors[0] as { ids: string[]; error: Error };
    expect(err.ids).toEqual(expect.arrayContaining(["1", "2", "3"]));
    expect(err.error).toBeInstanceOf(Error);
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
// store.subscribe — reentrancy
// =============================================================================

describe("store.subscribe reentrancy", () => {
  it("supports insertDocument called from inside a listener", () => {
    // A devtools or middleware-style listener may respond to an event
    // by writing to the cache (e.g. attaching derived data). The
    // resulting DOC_INSERT must fan out to all listeners normally,
    // without infinite loops or lost events. Iteration must walk a
    // snapshot of the listener list so the mutation doesn't corrupt
    // iteration.
    const seen: Array<string> = [];
    const { store } = makeStore();
    let patched = false;

    store.subscribe((event) => {
      if (event.kind === "DOC_INSERT") {
        seen.push(`A:${event.type}:${event.id}`);
        // Reentrant insert — once — to derive a related doc
        if (event.id === "1" && !patched) {
          patched = true;
          store.insertDocument({
            type: "post",
            id: "derived",
            attributes: { title: "derived", body: "b", authorId: "1" },
          });
        }
      }
    });
    store.subscribe((event) => {
      if (event.kind === "DOC_INSERT") {
        seen.push(`B:${event.type}:${event.id}`);
      }
    });

    store.insertDocument({
      type: "user",
      id: "1",
      attributes: { firstName: "X", lastName: "Y", email: "x@y" },
    });

    // Both listeners see both events, in order: the outer user insert
    // is fully delivered, then the reentrant post insert is delivered.
    expect(seen).toEqual(["A:user:1", "B:user:1", "A:post:derived", "B:post:derived"]);
  });

  it("iterates a snapshot of listeners so subscribe() from inside a listener doesn't fire for the current event", () => {
    // A listener that adds a new listener mid-dispatch must not cause
    // the new listener to receive the currently-dispatching event.
    // Iteration uses a snapshot of the list; the new listener will
    // see the NEXT event onward.
    const laterCalls: Array<string> = [];
    const { store } = makeStore();

    store.subscribe((event) => {
      if (event.kind === "DOC_INSERT" && event.id === "1") {
        store.subscribe((later) => {
          if (later.kind === "DOC_INSERT") {
            laterCalls.push(later.id);
          }
        });
      }
    });

    // First insert: the late subscriber isn't attached yet, so it
    // must NOT see this event.
    store.insertDocument({
      type: "user",
      id: "1",
      attributes: { firstName: "A", lastName: "B", email: "a@b" },
    });

    // Second insert: late subscriber is now attached.
    store.insertDocument({
      type: "user",
      id: "2",
      attributes: { firstName: "C", lastName: "D", email: "c@d" },
    });

    expect(laterCalls).toEqual(["2"]);
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
