import { effect } from "@supergrain/kernel";
import { AdapterError, createDocumentStore, type DocumentStore } from "@supergrain/silo";
import { Effect, Schedule } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createQuery, type QueryAdapter } from "../src";
import { setupFakeTimers } from "./setup/timers";

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

// Default the store to no retry so the suite's failure assertions are
// deterministic; pass a schedule to exercise inheritance of the store default.
function makeStore(
  retry: Schedule.Schedule<unknown, AdapterError> = Schedule.recurs(0),
): DocumentStore<TypeToModel> {
  return createDocumentStore<TypeToModel>({
    models: {
      planbooks_for_user: { adapter: { find: () => Effect.succeed({ data: [] }) } },
      planbook: { adapter: { find: () => Effect.succeed({ data: [] }) } },
    },
    retry,
  });
}

function makeAdapter(): {
  adapter: QueryAdapter<PlanbookRef>;
  fetch: ReturnType<typeof vi.fn>;
} {
  const fetch = vi.fn(() =>
    Effect.succeed({
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
    expect(q.failureCount).toBe(0);
    expect(q.lastError).toBeUndefined();
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
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0), ref("p2", 1)] },
        meta: { nextOffset: 2 },
      }),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();

    expect(fetch).toHaveBeenCalledWith("u1", expect.objectContaining({ offset: 0, limit: 200 }));
    expect(q.results).toEqual([ref("p1", 0), ref("p2", 1)]);
    expect(q.nextOffset).toBe(2);
  });

  it("writes the query slot to the store at (type, id)", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0)] },
        meta: { nextOffset: 1 },
      }),
    );

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

    expect(fetch).toHaveBeenCalledWith("u1", expect.objectContaining({ offset: 0, limit: 50 }));
    q.destroy();
  });

  it("preserves server response order on offset=0 (matches Ember semantics)", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0), ref("p2", 1), ref("p3", 2)] },
        meta: { nextOffset: 3 },
      }),
    );

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
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0)] },
        meta: { nextOffset: null },
        included: [
          { id: "p1", type: "planbook", title: "One" },
          { id: "p2", type: "planbook", title: "Two" },
        ],
      }),
    );

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

    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0), ref("p2", 1)] },
        meta: { nextOffset: 2 },
      }),
    );
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p3", 2), ref("p4", 3)] },
        meta: { nextOffset: null },
      }),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();
    await q.fetchNextPage();

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "u1",
      expect.objectContaining({ offset: 2, limit: 200 }),
    );
    expect(q.results).toEqual([ref("p1", 0), ref("p2", 1), ref("p3", 2), ref("p4", 3)]);
    expect(q.nextOffset).toBe(null);
  });

  it("positions results by server offset on later pages (sparse merge)", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0), ref("p2", 1)] },
        meta: { nextOffset: 2 },
      }),
    );
    // Second page: sparse items at offsets 2 and 4 (index 3 intentionally skipped).
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p3", 2), ref("p5", 4)] },
        meta: { nextOffset: 5 },
      }),
    );

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
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0)] },
        meta: { nextOffset: 1 },
      }),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.fetchNextPage();

    expect(fetch).toHaveBeenCalledWith("u1", expect.objectContaining({ offset: 0, limit: 200 }));
  });
});

describe("refetch replaces existing results", () => {
  it("drops old pages and starts fresh", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0), ref("p2", 1)] },
        meta: { nextOffset: 2 },
      }),
    );
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p3", 2)] },
        meta: { nextOffset: null },
      }),
    );
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("pX", 0)] },
        meta: { nextOffset: 1 },
      }),
    );

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
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0)] },
        meta: { nextOffset: 1 },
      }),
    );
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [] },
        meta: { nextOffset: null },
      }),
    );

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
    fetch.mockImplementationOnce(() =>
      Effect.promise(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    const pending = q.refetch();

    expect(q.isFetching).toBe(true);
    // The engine starts the adapter on a fiber tick (the overall `deadline`
    // races it), so wait for the invocation before driving the deferred.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    resolveFetch({ data: { results: [] }, meta: { nextOffset: null } });
    await pending;
    expect(q.isFetching).toBe(false);
  });
});

// =============================================================================
// Reactive subscriptions on the query handle
//
// `q.results`, `q.isFetching`, and `q.error` back the typical UI bindings
// (list display, spinner, error banner). A consumer subscribes to them via
// `effect()` (or any equivalent), and re-rendering depends on those signals
// firing when the underlying state changes. These tests pin that contract.
// =============================================================================

describe("reactive bindings on the query handle", () => {
  setupFakeTimers();

  it("an effect tracking q.results re-runs when refetch produces new data", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0)] },
        meta: { nextOffset: 1 },
      }),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    let observedIds: Array<string> = [];
    const resultsEffect = vi.fn(() => {
      observedIds = q.results.map((r) => r.id);
    });
    effect(resultsEffect);

    expect(observedIds).toEqual([]);
    expect(resultsEffect).toHaveBeenCalledTimes(1);

    await q.refetch();

    expect(observedIds).toEqual(["p1"]);
    expect(resultsEffect.mock.calls.length).toBeGreaterThanOrEqual(2);

    q.destroy();
  });

  it("an effect tracking q.isFetching toggles on fetch start and resolve", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    let resolveFetch: (v: {
      data: { results: Array<PlanbookRef> };
      meta: { nextOffset: number | null };
    }) => void = () => {};
    fetch.mockImplementationOnce(() =>
      Effect.promise(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    const fetchingHistory: Array<boolean> = [];
    effect(() => {
      fetchingHistory.push(q.isFetching);
    });

    expect(fetchingHistory).toEqual([false]);

    const pending = q.refetch();
    expect(fetchingHistory.at(-1)).toBe(true);

    // The engine starts the adapter on a fiber tick (the overall `deadline`
    // races it), so wait for the invocation before driving the deferred.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    resolveFetch({ data: { results: [] }, meta: { nextOffset: null } });
    await pending;
    expect(fetchingHistory.at(-1)).toBe(false);

    q.destroy();
  });

  it("an effect tracking q.error fires when a fetch fails and clears on a successful refetch", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockReturnValueOnce(
      Effect.fail(
        new AdapterError({ type: "planbooks_for_user", keys: [], cause: new Error("network") }),
      ),
    );
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0)] },
        meta: { nextOffset: null },
      }),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    const errorTags: Array<string | undefined> = [];
    effect(() => {
      errorTags.push((q.error as AdapterError | undefined)?._tag);
    });

    expect(errorTags).toEqual([undefined]);

    // No retry configured: a failure settles `error` immediately (like a silo
    // document fetch), and a later successful refetch clears it.
    await q.refetch();
    expect(errorTags.at(-1)).toBe("AdapterError");

    await q.refetch();
    expect(errorTags.at(-1)).toBeUndefined();

    q.destroy();
  });
});

// =============================================================================
// Retry (Schedule) — the same Effect engine the store's finder uses
// =============================================================================

describe("retry (Schedule) — same engine as ModelConfig.retry", () => {
  it("surfaces the failure immediately when retry is disabled", async () => {
    const store = makeStore(); // store default: Schedule.recurs(0)
    const { adapter, fetch } = makeAdapter();
    fetch.mockReturnValue(
      Effect.fail(
        new AdapterError({ type: "planbooks_for_user", keys: [], cause: new Error("boom") }),
      ),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    await q.refetch();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(q.error).toBeInstanceOf(AdapterError);
    expect((q.error as AdapterError)._tag).toBe("AdapterError");

    q.destroy();
  });

  it("inherits the store's default retry (no per-query `retry` set)", async () => {
    const store = makeStore(Schedule.recurs(1)); // store-level default: one retry
    const { adapter, fetch } = makeAdapter();
    fetch.mockReturnValueOnce(
      Effect.fail(
        new AdapterError({ type: "planbooks_for_user", keys: [], cause: new Error("network") }),
      ),
    );
    fetch.mockReturnValueOnce(
      Effect.succeed({ data: { results: [ref("p1", 0)] }, meta: { nextOffset: null } }),
    );

    // No `retry` on the query — it inherits the store default and retries once.
    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(q.error).toBeUndefined();
    expect(q.results).toEqual([ref("p1", 0)]);

    q.destroy();
  });

  it("a per-query `retry` overrides the store default", async () => {
    const store = makeStore(Schedule.recurs(5)); // store would retry a lot…
    const { adapter, fetch } = makeAdapter();
    fetch.mockReturnValue(
      Effect.fail(
        new AdapterError({ type: "planbooks_for_user", keys: [], cause: new Error("boom") }),
      ),
    );

    // …but the query opts out entirely.
    const q = createQuery({
      store,
      adapter,
      type: "planbooks_for_user",
      id: "u1",
      retry: Schedule.recurs(0),
    });
    await q.refetch();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(q.error).toBeInstanceOf(AdapterError);

    q.destroy();
  });

  it("retries a failing adapter on the configured Schedule, then succeeds", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockReturnValueOnce(
      Effect.fail(
        new AdapterError({ type: "planbooks_for_user", keys: [], cause: new Error("network") }),
      ),
    );
    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0)] },
        meta: { nextOffset: null },
      }),
    );

    const q = createQuery({
      store,
      adapter,
      type: "planbooks_for_user",
      id: "u1",
      retry: Schedule.recurs(1), // one retry => two attempts total
    });

    // The retry runs inside the awaited fetch, so `error` is never surfaced for
    // the swallowed first failure — exactly how a silo document fetch behaves.
    await q.refetch();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(q.error).toBeUndefined();
    expect(q.results).toEqual([ref("p1", 0)]);

    q.destroy();
  });

  it("surfaces the failure once the Schedule is exhausted", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockReturnValue(
      Effect.fail(
        new AdapterError({ type: "planbooks_for_user", keys: [], cause: new Error("down") }),
      ),
    );

    const q = createQuery({
      store,
      adapter,
      type: "planbooks_for_user",
      id: "u1",
      retry: Schedule.recurs(2), // three attempts, all fail
    });

    await q.refetch();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(q.error).toBeInstanceOf(AdapterError);

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
    fetch.mockReturnValue(
      Effect.succeed({
        data: { results: [ref("p1", 0)] },
        meta: { nextOffset: 1 },
      }),
    );

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

    expect(fetch).toHaveBeenLastCalledWith(
      "u1",
      expect.objectContaining({ offset: 0, limit: 200 }),
    );
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

  it("interrupts a retrying fetch so it stops issuing attempts", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    fetch.mockReturnValue(
      Effect.fail(
        new AdapterError({ type: "planbooks_for_user", keys: [], cause: new Error("boom") }),
      ),
    );

    const q = createQuery({
      store,
      adapter,
      type: "planbooks_for_user",
      id: "u1",
      retry: Schedule.recurs(3),
    });

    // Don't await: destroy mid-run interrupts the retry loop.
    const pending = q.refetch();
    q.destroy();
    await pending;

    const callsAtDestroy = fetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 0));
    // No further attempts after destroy interrupted the run.
    expect(fetch.mock.calls.length).toBe(callsAtDestroy);
  });

  it("aborts the in-flight adapter signal on destroy", async () => {
    const store = makeStore();
    let aborted = false;
    const adapter: QueryAdapter<PlanbookRef> = {
      fetch: (_id, opts) =>
        Effect.promise(
          () =>
            new Promise<never>(() => {
              opts.signal?.addEventListener("abort", () => {
                aborted = true;
              });
            }),
        ),
    };

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    const pending = q.refetch();
    q.destroy();
    await pending;
    await new Promise((r) => setTimeout(r, 0));

    expect(aborted).toBe(true);
  });

  it("ignores a fetch that resolves after destroy()", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    let resolveFetch: (v: {
      data: { results: Array<PlanbookRef> };
      meta: { nextOffset: number | null };
    }) => void = () => {};
    fetch.mockImplementationOnce(() =>
      Effect.promise(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
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

  it("ignores isFetching after a fetch rejects following destroy()", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    // `Effect.promise` surfaces a rejection as a *defect*, so `Effect.either`
    // does not absorb it — `runPromise` rejects and the failure lands in the
    // `catch` block, exercising its `destroyed` guard.
    let rejectFetch!: (error: Error) => void;
    fetch.mockImplementationOnce(() =>
      Effect.promise(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectFetch = reject;
          }),
      ),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    const pending = q.refetch();

    // The engine starts the adapter on a fiber tick (the overall `deadline`
    // races it), so wait for the invocation before destroying.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    q.destroy();

    rejectFetch(new Error("post-destroy-failure"));
    await pending.catch(() => {});

    expect(q.isFetching).toBe(false);
  });
});

describe("failure handling", () => {
  it("does not fetch after destroy()", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    q.destroy();

    await q.refetch();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("can merge a later page after the backing store was cleared", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();

    fetch.mockReturnValueOnce(
      Effect.succeed({
        data: { results: [ref("p1", 0), ref("p2", 1)] },
        meta: { nextOffset: 2 },
      }),
    );

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();
    expect(q.nextOffset).toBe(2);

    fetch.mockImplementationOnce(() =>
      Effect.sync(() => {
        store.clearMemory();
        return {
          data: { results: [ref("p3", 2)] },
          meta: { nextOffset: null },
        };
      }),
    );

    await q.fetchNextPage();
    expect(q.results[2]).toEqual(ref("p3", 2));
    q.destroy();
  });

  it("surfaces a non-AdapterError Effect failure as-is (store-consistent)", async () => {
    const store = makeStore();
    const { adapter, fetch } = makeAdapter();
    // A pathological Effect adapter that fails with a raw value rather than an
    // AdapterError. `coerceAdapter` only wraps Promise rejections, so an Effect
    // owns its failure channel — the raw value lands on `error` exactly as it
    // would on a silo `DocumentHandle.error`. No bespoke normalization.
    fetch.mockReturnValueOnce(Effect.fail("plain string error" as unknown as AdapterError));

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();

    expect(q.error).toBe("plain string error");
    q.destroy();
  });
});

// =============================================================================
// Promise-first adapter boundary
//
// `fetch` may return a plain Promise (the common case) or an Effect. The query
// normalizes both; a Promise rejection becomes an AdapterError.
// =============================================================================

describe("Promise-first adapter boundary", () => {
  it("accepts a Promise-returning fetch (no Effect) and writes results", async () => {
    const store = makeStore();
    const adapter: QueryAdapter<PlanbookRef> = {
      fetch: async () => ({ data: { results: [ref("p1", 0)] }, meta: { nextOffset: 1 } }),
    };

    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
    await q.refetch();

    expect(q.results).toEqual([ref("p1", 0)]);
    expect(q.nextOffset).toBe(1);
    q.destroy();
  });

  it("wraps a Promise rejection into an AdapterError (cause preserved)", async () => {
    const store = makeStore();
    const boom = new Error("query network down");
    const adapter: QueryAdapter<PlanbookRef> = {
      fetch: async () => {
        throw boom;
      },
    };

    const q = createQuery({
      store,
      adapter,
      type: "planbooks_for_user",
      id: "u1",
    });
    await q.refetch();

    expect(q.error).toBeInstanceOf(AdapterError);
    expect((q.error as AdapterError).cause).toBe(boom);
    q.destroy();
  });

  it("passes an AdapterError rejection through untouched (not re-wrapped)", async () => {
    const store = makeStore();
    const adapterErr = new AdapterError({
      type: "planbooks_for_user",
      keys: ["u1"],
      cause: new Error("already typed"),
    });
    const adapter: QueryAdapter<PlanbookRef> = {
      fetch: () => Promise.reject(adapterErr),
    };

    const q = createQuery({
      store,
      adapter,
      type: "planbooks_for_user",
      id: "u1",
    });
    await q.refetch();

    // The boundary preserves a pre-built AdapterError instead of wrapping it again.
    expect(q.error).toBe(adapterErr);
    q.destroy();
  });
});

// =============================================================================
// Failure visibility — nothing may vanish as a silent abort
// =============================================================================

describe("commit failures surface as ProcessorError", () => {
  it("records the error on the handle instead of silently aborting", async () => {
    const store = makeStore();
    // Malformed envelope: `data` missing, so commitPage throws reading
    // `res.data.results` — previously a defect the Aborted net swallowed.
    const adapter: QueryAdapter<PlanbookRef> = {
      fetch: () => Effect.succeed({} as never),
    };
    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    await q.refetch();

    expect(q.isFetching).toBe(false);
    expect(q.error?._tag).toBe("ProcessorError");
    expect(q.lastError?._tag).toBe("ProcessorError");
    expect(q.results).toEqual([]);
  });
});

describe("adapter defects surface instead of vanishing", () => {
  it("a synchronously-throwing adapter settles as an AdapterError", async () => {
    const store = makeStore();
    const adapter: QueryAdapter<PlanbookRef> = {
      fetch: () => {
        throw new Error("no session");
      },
    };
    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    await q.refetch();

    expect(q.error).toBeInstanceOf(AdapterError);
    expect(q.isFetching).toBe(false);
  });

  it("a dying adapter Effect settles as a non-retryable reason 'defect' error", async () => {
    const store = makeStore();
    const adapter: QueryAdapter<PlanbookRef> = {
      fetch: () => Effect.die(new Error("adapter bug")),
    };
    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    await q.refetch();

    expect(q.error).toBeInstanceOf(AdapterError);
    expect((q.error as AdapterError).reason).toBe("defect");
    expect(q.isFetching).toBe(false);
  });
});

// =============================================================================
// Store-level telemetry — the same onError sink the finder notifies
// =============================================================================

describe("DocumentStoreConfig.onError for query fetches", () => {
  function makeObservedStore(
    seen: Array<{ tag: string; keys: ReadonlyArray<string>; attempt: number }>,
  ) {
    return createDocumentStore<TypeToModel>({
      models: {
        planbooks_for_user: { adapter: { find: () => Effect.succeed({ data: [] }) } },
        planbook: { adapter: { find: () => Effect.succeed({ data: [] }) } },
      },
      retry: Schedule.recurs(1),
      onError: (error, ctx) => seen.push({ tag: error._tag, keys: ctx.keys, attempt: ctx.attempt }),
    });
  }

  it("reports every failed attempt, like a document fetch", async () => {
    const seen: Array<{ tag: string; keys: ReadonlyArray<string>; attempt: number }> = [];
    const store = makeObservedStore(seen);
    const fetch = vi.fn(() =>
      Effect.fail(new AdapterError({ type: "planbooks_for_user", keys: ["u1"], cause: "down" })),
    );
    const q = createQuery({ store, adapter: { fetch }, type: "planbooks_for_user", id: "u1" });

    await q.refetch();

    expect(fetch).toHaveBeenCalledTimes(2); // store retry: recurs(1)
    expect(seen).toEqual([
      { tag: "AdapterError", keys: ["u1"], attempt: 1 },
      { tag: "AdapterError", keys: ["u1"], attempt: 2 },
    ]);
    expect(q.error).toBeInstanceOf(AdapterError);
  });

  it("reports a commit failure exactly once", async () => {
    const seen: Array<{ tag: string; keys: ReadonlyArray<string>; attempt: number }> = [];
    const store = makeObservedStore(seen);
    const adapter: QueryAdapter<PlanbookRef> = {
      fetch: () => Effect.succeed({} as never), // malformed envelope
    };
    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    await q.refetch();

    expect(seen).toEqual([{ tag: "ProcessorError", keys: ["u1"], attempt: 1 }]);
  });

  it("a throwing sink never breaks the fetch", async () => {
    const store = createDocumentStore<TypeToModel>({
      models: {
        planbooks_for_user: { adapter: { find: () => Effect.succeed({ data: [] }) } },
        planbook: { adapter: { find: () => Effect.succeed({ data: [] }) } },
      },
      retry: Schedule.recurs(1),
      onError: () => {
        throw new Error("telemetry boom");
      },
    });
    let calls = 0;
    const adapter: QueryAdapter<PlanbookRef> = {
      fetch: () =>
        Effect.suspend(() => {
          calls += 1;
          return calls === 1
            ? Effect.fail(
                new AdapterError({ type: "planbooks_for_user", keys: ["u1"], cause: "blip" }),
              )
            : Effect.succeed({
                data: { results: [] as Array<PlanbookRef> },
                meta: { nextOffset: null as number | null },
                included: undefined,
              });
        }),
    };
    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    await q.refetch();

    // The sink threw on the first attempt's report; the retry still ran and
    // the fetch settled cleanly.
    expect(calls).toBe(2);
    expect(q.error).toBeUndefined();
    expect(q.isFetching).toBe(false);
  });
});

describe("defect net for non-engine throws", () => {
  it("settles as reason 'defect' when a subscriber throws during the Failed flush", async () => {
    const store = makeStore();
    const fetch = vi.fn(() =>
      Effect.fail(new AdapterError({ type: "planbooks_for_user", keys: ["u1"], cause: "down" })),
    );
    const q = createQuery({ store, adapter: { fetch }, type: "planbooks_for_user", id: "u1" });

    // A consumer effect tracking q.error throws when the Failed flush
    // notifies it — a defect outside the engine, which runAdapter's own
    // coercion can't see. The net must record it instead of letting
    // runPromiseExit discard the failure invisibly.
    let threw = false;
    const dispose = effect(() => {
      if (q.error !== undefined && !threw) {
        threw = true;
        throw new Error("subscriber bug");
      }
    });
    await q.refetch();

    expect(q.error).toBeInstanceOf(AdapterError);
    expect((q.error as AdapterError).reason).toBe("defect");
    expect(q.isFetching).toBe(false);
    dispose();
  });
});

describe("single-flight supersession corners", () => {
  interface Envelope {
    data: { results: Array<PlanbookRef> };
    meta: { nextOffset: number | null };
  }

  /** Real-timer macrotask hop — lets forked fibers reach the adapter call. */
  function tick(ms = 0): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function makeDeferredAdapter(): {
    adapter: QueryAdapter<PlanbookRef>;
    fetch: ReturnType<typeof vi.fn>;
    pending: Array<{ offset: number; resolve: (env: Envelope) => void }>;
  } {
    const pending: Array<{ offset: number; resolve: (env: Envelope) => void }> = [];
    const fetch = vi.fn(
      (_id: string, opts: { offset: number; limit: number; signal?: AbortSignal }) =>
        new Promise<Envelope>((resolve) => pending.push({ offset: opts.offset, resolve })),
    );
    return { adapter: { fetch }, fetch, pending };
  }

  it("fetchNextPage waits for an in-flight refetch instead of aborting it", async () => {
    const store = makeStore();
    const { adapter, fetch, pending } = makeDeferredAdapter();
    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    // Seed page 0.
    const seed = q.refetch();
    await tick();
    pending[0]!.resolve({ data: { results: [ref("stale", 0)] }, meta: { nextOffset: 1 } });
    await seed;

    // A live invalidation starts a refetch…
    const invalidation = q.refetch();
    await tick();
    // …and the user scrolls before it lands. Aborting the refetch here would
    // silently drop the fresher page 0 and merge the next page onto stale data.
    const nextPage = q.fetchNextPage();
    await tick();

    // The refetch must still be live — resolve it with the fresh page 0.
    pending[1]!.resolve({ data: { results: [ref("fresh", 0)] }, meta: { nextOffset: 1 } });
    await invalidation;
    await tick();

    // Only now does the next page go out, with the refreshed offset.
    expect(fetch).toHaveBeenCalledTimes(3);
    pending[2]!.resolve({ data: { results: [ref("p2", 1)] }, meta: { nextOffset: null } });
    await nextPage;

    expect(q.results).toEqual([ref("fresh", 0), ref("p2", 1)]);
    expect(q.error).toBeUndefined();
  });

  it("an awaited refetch superseded by a newer refetch settles only when the replacement does", async () => {
    const store = makeStore();
    const { adapter, pending } = makeDeferredAdapter();
    const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

    const first = q.refetch();
    await tick();
    const second = q.refetch(); // supersedes — aborts the first run
    await tick();

    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    await tick(5);
    // The superseded run committed nothing — its caller must not observe a
    // silent success while the replacement is still in flight.
    expect(firstSettled).toBe(false);

    pending[1]!.resolve({ data: { results: [ref("v2", 0)] }, meta: { nextOffset: null } });
    await second;
    await first; // follows the replacement
    expect(q.results).toEqual([ref("v2", 0)]);
  });
});
