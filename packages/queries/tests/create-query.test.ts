import { createDocumentStore, type DocumentStore } from "@supergrain/silo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQuery, type QueryAdapter } from "../src";

// =============================================================================
// Shared types / fixtures
// =============================================================================

interface PlanbookRef {
  type: string;
  id: string;
  offset: number;
}

type TypeToModel = {
  planbooks_for_user: {
    id: string;
    type: "planbooks_for_user";
    results: Array<PlanbookRef>;
    nextOffset: number | null;
  };
  planbook: { id: string; type: "planbook"; title?: string };
};

function makeStore(): DocumentStore<TypeToModel> {
  return createDocumentStore<TypeToModel>({
    models: {
      planbooks_for_user: { adapter: { find: () => Promise.resolve({ data: [] }) } },
      planbook: { adapter: { find: () => Promise.resolve({ data: [] }) } },
    },
  });
}

function makeAdapter(): {
  adapter: QueryAdapter<PlanbookRef>;
  fetch: ReturnType<typeof vi.fn>;
} {
  const fetch = vi.fn(() =>
    Promise.resolve({
      data: { results: [] as Array<PlanbookRef> },
      meta: { nextOffset: null as number | null },
      included: undefined as Array<{ type: string; id: string }> | undefined,
    }),
  );
  return { adapter: { fetch }, fetch };
}

function ref(id: string, offset: number): PlanbookRef {
  return { type: "planbook", id, offset };
}

// =============================================================================
// API surface
// =============================================================================

describe("createQuery", () => {
  it("returns a reactive handle with the full public API", () => {
    const store = makeStore();
    const { adapter } = makeAdapter();

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    expect(Array.isArray(q.results)).toBe(true);
    expect(q.nextOffset).toBe(null);
    expect(q.isFetching).toBe(false);
    expect(q.error).toBeUndefined();
    expect(typeof q.fetchNextPage).toBe("function");
    expect(typeof q.refetch).toBe("function");
    expect(typeof q.destroy).toBe("function");
  });
});

// =============================================================================
// Basic fetch
// =============================================================================

describe("refetch", () => {
  it("fetches from offset 0 and writes results into the store", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0), ref("p2", 1)] },
      meta: { nextOffset: 2 },
    });

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();

    expect(fetch).toHaveBeenCalledWith("u1", { offset: 0, limit: 200 });
    expect(q.results).toEqual([ref("p1", 0), ref("p2", 1)]);
    expect(q.nextOffset).toBe(2);
  });

  it("writes the query slot to the store at (type, id)", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0)] },
      meta: { nextOffset: 1 },
    });

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();

    const slot = store.findInMemory("planbooks_for_user", "u1");
    expect(slot).toEqual({
      id: "u1",
      type: "planbooks_for_user",
      results: [ref("p1", 0)],
      nextOffset: 1,
    });
  });

  it("respects a custom limit", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    const q = createQuery({
      store,
      adapter,
      type: "planbooks_for_user",
      id: "u1",
      limit: 50,
    });
    await q.refetch();

    expect(fetch).toHaveBeenCalledWith("u1", { offset: 0, limit: 50 });
    q.destroy();
  });

  it("preserves server response order on offset=0 (matches Ember semantics)", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0), ref("p2", 1), ref("p3", 2)] },
      meta: { nextOffset: 3 },
    });

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();

    expect(q.results).toEqual([ref("p1", 0), ref("p2", 1), ref("p3", 2)]);
    expect(q.results.length).toBe(3);
  });
});

// =============================================================================
// Included sideload
// =============================================================================

describe("included sideload", () => {
  it("inserts each included document into the store via insertDocument", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0)] },
      meta: { nextOffset: null },
      included: [
        { id: "p1", type: "planbook", title: "One" },
        { id: "p2", type: "planbook", title: "Two" },
      ],
    });

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();

    expect(store.findInMemory("planbook", "p1")).toMatchObject({ title: "One" });
    expect(store.findInMemory("planbook", "p2")).toMatchObject({ title: "Two" });
  });
});

// =============================================================================
// Pagination
// =============================================================================

describe("fetchNextPage", () => {
  it("uses the stored nextOffset and sparse-merges results by server offset", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0), ref("p2", 1)] },
      meta: { nextOffset: 2 },
    });
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p3", 2), ref("p4", 3)] },
      meta: { nextOffset: null },
    });

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();
    await q.fetchNextPage();

    expect(fetch).toHaveBeenNthCalledWith(2, "u1", { offset: 2, limit: 200 });
    expect(q.results).toEqual([ref("p1", 0), ref("p2", 1), ref("p3", 2), ref("p4", 3)]);
    expect(q.nextOffset).toBe(null);
  });

  it("positions results by server offset on later pages (sparse merge)", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0), ref("p2", 1)] },
      meta: { nextOffset: 2 },
    });
    // Second page: sparse items at offsets 2 and 4 (index 3 intentionally skipped).
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p3", 2), ref("p5", 4)] },
      meta: { nextOffset: 5 },
    });

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();
    await q.fetchNextPage();

    expect(q.results[0]).toEqual(ref("p1", 0));
    expect(q.results[1]).toEqual(ref("p2", 1));
    expect(q.results[2]).toEqual(ref("p3", 2));
    expect(q.results[4]).toEqual(ref("p5", 4));
  });

  it("defaults to offset 0 when no nextOffset is stored yet", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0)] },
      meta: { nextOffset: 1 },
    });

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.fetchNextPage();

    expect(fetch).toHaveBeenCalledWith("u1", { offset: 0, limit: 200 });
  });
});

describe("refetch replaces existing results", () => {
  it("drops old pages and starts fresh", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0), ref("p2", 1)] },
      meta: { nextOffset: 2 },
    });
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p3", 2)] },
      meta: { nextOffset: null },
    });
    fetch.mockResolvedValueOnce({
      data: { results: [ref("pX", 0)] },
      meta: { nextOffset: 1 },
    });

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();
    await q.fetchNextPage();
    expect(q.results.length).toBe(3);

    await q.refetch();
    expect(q.results).toEqual([ref("pX", 0)]);
    expect(q.nextOffset).toBe(1);
  });
});

describe("empty results", () => {
  it("resets the results array to empty", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0)] },
      meta: { nextOffset: 1 },
    });
    fetch.mockResolvedValueOnce({
      data: { results: [] },
      meta: { nextOffset: null },
    });

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();
    expect(q.results.length).toBe(1);

    await q.refetch();
    expect(q.results).toEqual([]);
  });
});

// =============================================================================
// isFetching state
// =============================================================================

describe("isFetching", () => {
  it("is true during fetch and false after resolve", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    let resolveFetch: (v: {
      data: { results: Array<PlanbookRef> };
      meta: { nextOffset: number | null };
    }) => void = () => {};
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    const pending = q.refetch();

    expect(q.isFetching).toBe(true);
    resolveFetch({ data: { results: [] }, meta: { nextOffset: null } });
    await pending;
    expect(q.isFetching).toBe(false);
  });
});

// =============================================================================
// Error + backoff retry
// =============================================================================

describe("error + backoff retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets error signal on failure and retries after backoff delay", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockRejectedValueOnce(new Error("network"));
    fetch.mockResolvedValueOnce({
      data: { results: [ref("p1", 0)] },
      meta: { nextOffset: null },
    });

    const q = createQuery({
      store,
      adapter,
      type: "planbooks_for_user",
      id: "u1",
      backoff: () => 50,
    });

    await q.refetch();
    expect(q.error).toBeInstanceOf(Error);
    expect(q.error?.message).toBe("network");

    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(q.error).toBeUndefined();
    expect(q.results).toEqual([ref("p1", 0)]);

    q.destroy();
  });

  it("increments attempts counter so backoff grows", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockRejectedValue(new Error("boom"));
    const backoff = vi.fn((_attempt: number) => 10);

    const q = createQuery({
      store,
      adapter,
      type: "planbooks_for_user",
      id: "u1",
      backoff,
    });

    await q.refetch();
    expect(backoff.mock.calls.map((c) => c[0])).toEqual([1]);

    await vi.advanceTimersByTimeAsync(11);
    expect(backoff.mock.calls.map((c) => c[0])).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(11);
    expect(backoff.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);

    q.destroy();
  });
});

// =============================================================================
// Live subscribe
// =============================================================================

describe("subscribe hook", () => {
  it("calls subscribe on init with (type, id, onInvalidate)", () => {
    const store = makeStore();
    const { adapter } = makeAdapter();
    const subscribe = vi.fn(
      (_type: "planbooks_for_user", _id: string, _onInvalidate: () => void) => () => {},
    );

    createQuery({ store, adapter, type: "planbooks_for_user", id: "u1", subscribe });

    expect(subscribe).toHaveBeenCalledTimes(1);
    const call = subscribe.mock.calls[0];
    expect(call[0]).toBe("planbooks_for_user");
    expect(call[1]).toBe("u1");
    expect(typeof call[2]).toBe("function");
  });

  it("refetches from offset 0 when the subscriber fires onInvalidate", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockResolvedValue({
      data: { results: [ref("p1", 0)] },
      meta: { nextOffset: 1 },
    });

    let fireInvalidate: () => void = () => {};
    const subscribe = vi.fn(
      (_type: "planbooks_for_user", _id: string, onInvalidate: () => void) => {
        fireInvalidate = onInvalidate;
        return () => {};
      },
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1", subscribe });
    await q.refetch();
    expect(fetch).toHaveBeenCalledTimes(1);

    fireInvalidate();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    expect(fetch).toHaveBeenLastCalledWith("u1", { offset: 0, limit: 200 });
    q.destroy();
  });
});

// =============================================================================
// Destroy
// =============================================================================

describe("destroy", () => {
  it("calls the subscriber's unsubscribe", () => {
    const store = makeStore();
    const { adapter } = makeAdapter();
    const unsub = vi.fn();
    const subscribe = vi.fn(() => unsub);

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1", subscribe });
    q.destroy();

    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending retry timer", async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      const { adapter, fetch } = makeAdapter();
      fetch.mockRejectedValue(new Error("boom"));

      const q = createQuery({
        store,
        adapter,
        type: "planbooks_for_user",
        id: "u1",
        backoff: () => 100,
      });
      await q.refetch();
      expect(q.error).toBeInstanceOf(Error);

      q.destroy();
      await vi.advanceTimersByTimeAsync(500);

      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a fetch that resolves after destroy()", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    let resolveFetch: (v: {
      data: { results: Array<PlanbookRef> };
      meta: { nextOffset: number | null };
    }) => void = () => {};
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    const pending = q.refetch();
    q.destroy();

    resolveFetch({
      data: { results: [ref("p1", 0)] },
      meta: { nextOffset: null },
    });
    await pending;

    expect(store.findInMemory("planbooks_for_user", "u1")).toBeUndefined();
  });
});
