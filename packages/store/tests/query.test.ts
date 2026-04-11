import type { QueryAdapter, QueryResponse } from "../src";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { flushCoalescer, makeFeedAdapter, makeStore } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// query — basic fetch + projection
// =============================================================================

describe("query basic fetch", () => {
  it("returns a pending handle synchronously", () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });

    expect(q.status).toBe("PENDING");
    expect(q.refs).toBeUndefined();
    expect(q.isPending).toBe(true);
    expect(q.isFetching).toBe(true);
    expect(q.error).toBeUndefined();
    expect(q.hasData).toBe(false);
    expect(q.fetchedAt).toBeUndefined();
    // Before the first page loads, nextOffset is null (not undefined).
    expect(q.nextOffset).toBeNull();
  });

  it("exposes refs after fetch resolves, preserving server order", async () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    expect(q.status).toBe("SUCCESS");
    expect(q.refs).toHaveLength(2);
    expect(q.refs?.[0]).toEqual({ type: "post", id: "10" });
    expect(q.refs?.[1]).toEqual({ type: "post", id: "11" });
    expect(q.nextOffset).toBeNull();
    expect(q.hasData).toBe(true);
    expect(q.fetchedAt).toBeInstanceOf(Date);
  });

  it("treats an omitted (undefined) nextOffset as exhausted (null)", async () => {
    const feedNoOffset: QueryAdapter = {
      fetch: vi.fn(async () => ({
        data: [{ type: "post", id: "10" }],
        included: [
          {
            type: "post",
            id: "10",
            attributes: { title: "P10", body: "b", authorId: "1" },
          },
        ],
        // nextOffset field omitted entirely
      })),
    };
    const { store } = makeStore({
      queries: { "activity-feed": feedNoOffset },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    expect(q.nextOffset).toBeNull();
  });

  it("normalizes `included` into the doc cache so findDoc hits without refetching", async () => {
    const { store, postAdapter } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    const doc = store.findDoc("post", "10");
    expect(doc.status).toBe("SUCCESS");
    expect(doc.data?.title).toBe("P10");
    expect(postAdapter.find).not.toHaveBeenCalled();
  });

  it("recomputes items reactively when an underlying doc changes", async () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    // Read via findDoc to prove reactive propagation through the doc cache
    const post = store.findDoc("post", "10");
    expect(post.data?.title).toBe("P10");

    store.insertDocument({
      type: "post",
      id: "10",
      attributes: { title: "P10-edited", body: "b", authorId: "1" },
    });

    expect(post.data?.title).toBe("P10-edited");
  });
});

// =============================================================================
// query — refetch
// =============================================================================

describe("query refetch", () => {
  it("keeps isPending false across a query refetch, only toggling isFetching", async () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    expect(q.isPending).toBe(false);
    expect(q.isFetching).toBe(false);

    q.refetch();
    expect(q.isPending).toBe(false);
    expect(q.isFetching).toBe(true);

    await flushCoalescer();
    expect(q.isFetching).toBe(false);
  });

  it("refetch while a query fetch is already in flight is a no-op (dedup)", async () => {
    const feed = makeFeedAdapter();
    const { store } = makeStore({
      queries: { "activity-feed": feed },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    q.refetch();
    q.refetch();

    await flushCoalescer();

    expect(feed.fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces query adapter errors via the error field", async () => {
    const failingFeed: QueryAdapter = {
      fetch: vi.fn(async () => {
        throw new Error("feed boom");
      }),
    };
    const { store } = makeStore({
      queries: { "activity-feed": failingFeed },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    expect(q.status).toBe("ERROR");
    expect(q.error).toBeInstanceOf(Error);
    expect(q.error?.message).toBe("feed boom");
    expect(q.isFetching).toBe(false);
    expect(q.refs).toBeUndefined();
  });
});

// =============================================================================
// query — key hashing + handle identity
// =============================================================================

describe("query key hashing", () => {
  it("returns the same stable handle for identical query defs", () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const a = store.query({ type: "activity-feed", id: "u1" });
    const b = store.query({ type: "activity-feed", id: "u1" });

    expect(a).toBe(b);
  });

  it("is insensitive to the key ordering of `params`", () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const a = store.query({
      type: "activity-feed",
      id: "u1",
      params: { a: 1, b: 2 },
    });
    const b = store.query({
      type: "activity-feed",
      id: "u1",
      params: { b: 2, a: 1 },
    });

    expect(a).toBe(b);
  });

  it("is insensitive to nested object key ordering", () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const a = store.query({
      type: "activity-feed",
      id: "u1",
      params: { filter: { x: 1, y: 2 } },
    });
    const b = store.query({
      type: "activity-feed",
      id: "u1",
      params: { filter: { y: 2, x: 1 } },
    });

    expect(a).toBe(b);
  });

  it("IS sensitive to array element order (arrays are ordered)", () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const a = store.query({
      type: "activity-feed",
      id: "u1",
      params: { tags: ["a", "b"] },
    });
    const b = store.query({
      type: "activity-feed",
      id: "u1",
      params: { tags: ["b", "a"] },
    });

    expect(a).not.toBe(b);
  });

  it("returns different handles for different params values", () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const a = store.query({
      type: "activity-feed",
      id: "u1",
      params: { filter: "recent" },
    });
    const b = store.query({
      type: "activity-feed",
      id: "u1",
      params: { filter: "all" },
    });

    expect(a).not.toBe(b);
  });

  it("returns different handles for different pageSize", () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const a = store.query({ type: "activity-feed", id: "u1", pageSize: 20 });
    const b = store.query({ type: "activity-feed", id: "u1", pageSize: 50 });

    expect(a).not.toBe(b);
  });

  it("returns different handles for different ids", () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const a = store.query({ type: "activity-feed", id: "u1" });
    const b = store.query({ type: "activity-feed", id: "u2" });

    expect(a).not.toBe(b);
  });
});

// =============================================================================
// query — concurrent call deduplication
// =============================================================================

describe("query concurrent dedup", () => {
  it("fires only one adapter call for concurrent identical queries in the same tick", async () => {
    const feed = makeFeedAdapter();
    const { store } = makeStore({
      queries: { "activity-feed": feed },
    });

    store.query({ type: "activity-feed", id: "u1" });
    store.query({ type: "activity-feed", id: "u1" });
    store.query({ type: "activity-feed", id: "u1" });

    await flushCoalescer();

    expect(feed.fetch).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// query — pagination
// =============================================================================

describe("query pagination", () => {
  function makePagedFeedAdapter(): QueryAdapter {
    const page0: QueryResponse = {
      data: [
        { type: "post", id: "10" },
        { type: "post", id: "11" },
      ],
      included: [
        {
          type: "post",
          id: "10",
          attributes: { title: "P10", body: "b", authorId: "1" },
        },
        {
          type: "post",
          id: "11",
          attributes: { title: "P11", body: "b", authorId: "1" },
        },
      ],
      nextOffset: 2,
    };
    const page1: QueryResponse = {
      data: [
        { type: "post", id: "12" },
        { type: "post", id: "13" },
      ],
      included: [
        {
          type: "post",
          id: "12",
          attributes: { title: "P12", body: "b", authorId: "1" },
        },
        {
          type: "post",
          id: "13",
          attributes: { title: "P13", body: "b", authorId: "1" },
        },
      ],
      nextOffset: null,
    };

    let call = 0;
    return {
      fetch: vi.fn(async () => {
        const result = call === 0 ? page0 : page1;
        call++;
        return result;
      }),
    };
  }

  it("fetchNextPage appends refs and updates nextOffset", async () => {
    const feed = makePagedFeedAdapter();
    const { store } = makeStore({
      queries: { feed },
    });

    const q = store.query({ type: "feed", id: "u1", pageSize: 2 });
    await flushCoalescer();

    expect(q.refs).toHaveLength(2);
    expect(q.nextOffset).toBe(2);

    q.fetchNextPage();
    expect(q.isFetching).toBe(true);
    expect(q.isPending).toBe(false);

    await flushCoalescer();

    expect(q.refs).toHaveLength(4);
    expect(q.refs?.[2]).toEqual({ type: "post", id: "12" });
    expect(q.refs?.[3]).toEqual({ type: "post", id: "13" });
    expect(q.nextOffset).toBeNull();
    expect(q.isFetching).toBe(false);
  });

  it("passes offset:0 on the first page and offset:<nextOffset> on subsequent pages", async () => {
    const feed = makePagedFeedAdapter();
    const { store } = makeStore({
      queries: { feed },
    });

    const q = store.query({ type: "feed", id: "u1", pageSize: 2 });
    await flushCoalescer();

    const firstCall = (feed.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall.page).toEqual({ offset: 0, limit: 2 });

    q.fetchNextPage();
    await flushCoalescer();

    const secondCall = (feed.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(secondCall.page).toEqual({ offset: 2, limit: 2 });
  });

  it("fetchNextPage is a no-op while the initial fetch is still in flight", async () => {
    // Before the first page resolves, `nextOffset` is null and status
    // is PENDING. Calling fetchNextPage in that window must NOT dispatch
    // a second adapter call — there's no cursor yet and the initial
    // fetch is already doing the work. The handle stays PENDING.
    const feed = makePagedFeedAdapter();
    const { store } = makeStore({
      queries: { feed },
    });

    const q = store.query({ type: "feed", id: "u1", pageSize: 2 });
    expect(q.status).toBe("PENDING");
    expect(q.nextOffset).toBeNull();

    q.fetchNextPage(); // should no-op — initial fetch in flight

    await flushCoalescer();

    // Exactly one adapter call: the original query fetch
    expect(feed.fetch).toHaveBeenCalledTimes(1);
    expect(q.refs).toHaveLength(2);
    expect(q.nextOffset).toBe(2);
  });

  it("preserves duplicate refs across pages (does not dedupe)", async () => {
    // A server that returns the same ref on two adjacent pages is
    // either paginating a live feed or leaking an indexing bug — either
    // way, the store's job is to append refs verbatim, not to hide it.
    // Callers that want dedup must do it themselves.
    const page0: QueryResponse = {
      data: [
        { type: "post", id: "10" },
        { type: "post", id: "11" },
      ],
      included: [],
      nextOffset: 2,
    };
    const page1: QueryResponse = {
      data: [
        { type: "post", id: "11" }, // duplicate across pages
        { type: "post", id: "12" },
      ],
      included: [],
      nextOffset: null,
    };
    let call = 0;
    const feed: QueryAdapter = {
      fetch: vi.fn(async () => (call++ === 0 ? page0 : page1)),
    };
    const { store } = makeStore({
      queries: { feed },
    });

    const q = store.query({ type: "feed", id: "u1", pageSize: 2 });
    await flushCoalescer();
    expect(q.refs).toHaveLength(2);

    q.fetchNextPage();
    await flushCoalescer();

    expect(q.refs).toHaveLength(4);
    expect(q.refs?.map((r) => r.id)).toEqual(["10", "11", "11", "12"]);
  });

  it("fetchNextPage is a no-op when nextOffset is null", async () => {
    const feed = makeFeedAdapter(); // returns nextOffset: null
    const { store } = makeStore({
      queries: { "activity-feed": feed },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    expect(q.nextOffset).toBeNull();
    expect(feed.fetch).toHaveBeenCalledTimes(1);

    q.fetchNextPage();
    await flushCoalescer();

    expect(feed.fetch).toHaveBeenCalledTimes(1);
    expect(q.refs).toHaveLength(2);
  });
});

// =============================================================================
// query — stable .promise for React.use()
// =============================================================================

describe("query .promise", () => {
  it("resolves to the first page's refs on first load", async () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    expect(q.promise).toBeInstanceOf(Promise);

    await flushCoalescer();

    const refs = await q.promise!;
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ type: "post", id: "10" });
  });

  it("is stable across refetch (does not create a new promise)", async () => {
    const { store } = makeStore({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    await flushCoalescer();

    const first = q.promise;
    q.refetch();

    expect(q.promise).toBe(first);
  });

  it("preserves refs array identity across fetchNextPage (in-place growth)", async () => {
    // `QueryPromise.refs` mutates in place across pagination — taking
    // a reference to it before fetchNextPage and checking after must
    // yield the SAME array instance with new items appended. This is
    // the foundation for the `.promise` freeze-to-first-page contract:
    // the resolved value IS the refs array, and it grows as new pages
    // arrive. An impl that replaced refs with a fresh array per page
    // would break Suspense consumers reading the initial resolved value.
    const pages: QueryResponse[] = [
      {
        data: [
          { type: "post", id: "10" },
          { type: "post", id: "11" },
        ],
        included: [],
        nextOffset: 2,
      },
      {
        data: [
          { type: "post", id: "12" },
          { type: "post", id: "13" },
        ],
        included: [],
        nextOffset: null,
      },
    ];
    let call = 0;
    const feed: QueryAdapter = {
      fetch: vi.fn(async () => pages[call++]!),
    };
    const { store } = makeStore({
      queries: { feed },
    });

    const q = store.query({ type: "feed", id: "u1", pageSize: 2 });
    await flushCoalescer();

    const firstRefs = q.refs;
    expect(firstRefs).toHaveLength(2);

    q.fetchNextPage();
    await flushCoalescer();

    // Same array instance — not replaced
    expect(q.refs).toBe(firstRefs);
    // And the held reference now sees the appended items
    expect(firstRefs).toHaveLength(4);
    expect(firstRefs?.[2]).toEqual({ type: "post", id: "12" });
    expect(firstRefs?.[3]).toEqual({ type: "post", id: "13" });
  });

  it("is stable across fetchNextPage (promise identity unchanged)", async () => {
    // `refs` mutates in place as new pages arrive, but the .promise
    // field's identity does NOT change — consumers reading refs
    // re-render via reactivity, not by re-suspending.
    const pages: QueryResponse[] = [
      {
        data: [
          { type: "post", id: "10" },
          { type: "post", id: "11" },
        ],
        included: [],
        nextOffset: 2,
      },
      {
        data: [
          { type: "post", id: "12" },
          { type: "post", id: "13" },
        ],
        included: [],
        nextOffset: null,
      },
    ];
    let call = 0;
    const feed: QueryAdapter = {
      fetch: vi.fn(async () => pages[call++]!),
    };
    const { store } = makeStore({
      queries: { feed },
    });

    const q = store.query({ type: "feed", id: "u1", pageSize: 2 });
    await flushCoalescer();

    const first = q.promise;
    expect(first).toBeInstanceOf(Promise);

    q.fetchNextPage();
    await flushCoalescer();

    expect(q.refs).toHaveLength(4);
    expect(q.promise).toBe(first);
  });

  it("rejects once on initial error", async () => {
    const failingFeed: QueryAdapter = {
      fetch: vi.fn(async () => {
        throw new Error("query-promise-boom");
      }),
    };
    const { store } = makeStore({
      queries: { "activity-feed": failingFeed },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    const p = q.promise;

    await flushCoalescer();

    expect(q.status).toBe("ERROR");
    await expect(p).rejects.toThrow("query-promise-boom");
  });

  it("creates a NEW .promise on successful refetch after an error", async () => {
    let callCount = 0;
    const flakyFeed: QueryAdapter = {
      fetch: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error("flaky-feed");
        return {
          data: [{ type: "post", id: "10" }],
          included: [
            {
              type: "post",
              id: "10",
              attributes: { title: "P10", body: "b", authorId: "1" },
            },
          ],
          nextOffset: null,
        };
      }),
    };
    const { store } = makeStore({
      queries: { "activity-feed": flakyFeed },
    });

    const q = store.query({ type: "activity-feed", id: "u1" });
    const firstPromise = q.promise;
    await flushCoalescer();

    expect(q.status).toBe("ERROR");
    await firstPromise?.catch(() => {});

    q.refetch();
    await flushCoalescer();

    expect(q.status).toBe("SUCCESS");
    expect(q.promise).not.toBe(firstPromise);
  });
});
