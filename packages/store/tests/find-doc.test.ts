import type { DocumentAdapter } from "../src";
import type { User } from "./helpers";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { flushCoalescer, makePostAdapter, makeStore } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// findDoc — single id
// =============================================================================

describe("findDoc (single id)", () => {
  it("returns a pending handle synchronously for an unknown doc", () => {
    const { store } = makeStore();
    const doc = store.findDoc("user", "1");

    expect(doc.status).toBe("pending");
    expect(doc.data).toBeUndefined();
    expect(doc.isPending).toBe(true);
    expect(doc.isFetching).toBe(true);
    expect(doc.hasData).toBe(false);
    expect(doc.error).toBeUndefined();
    expect(doc.fetchedAt).toBeUndefined();
    expect(doc.revision).toBeUndefined();
  });

  it("invokes the per-type adapter and populates data after the batch tick", async () => {
    const { store, userAdapter } = makeStore();
    const doc = store.findDoc("user", "1");

    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
    expect(userAdapter.find).toHaveBeenCalledWith(["1"]);
    expect(doc.status).toBe("success");
    expect(doc.isPending).toBe(false);
    expect(doc.isFetching).toBe(false);
    expect(doc.hasData).toBe(true);
    expect(doc.data?.firstName).toBe("User1");
    expect(doc.fetchedAt).toBeInstanceOf(Date);
    expect(doc.revision).toBe(1);
  });

  it("fires separate adapter calls per type in the same tick", async () => {
    const { store, userAdapter, postAdapter } = makeStore();

    store.findDoc("user", "1");
    store.findDoc("post", "10");

    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
    expect(postAdapter.find).toHaveBeenCalledTimes(1);
  });

  it("returns the same stable handle for repeat calls with the same (type, id)", () => {
    const { store } = makeStore();
    const a = store.findDoc("user", "1");
    const b = store.findDoc("user", "1");

    expect(a).toBe(b);
  });

  it("returns DIFFERENT handles for different ids of the same type", () => {
    const { store } = makeStore();
    const a = store.findDoc("user", "1");
    const b = store.findDoc("user", "2");

    expect(a).not.toBe(b);
  });
});

// =============================================================================
// findDoc — idle state (null / undefined id)
// =============================================================================

describe("findDoc idle state", () => {
  it("satisfies the full idle invariant when id is null", () => {
    const { store, userAdapter } = makeStore();
    const doc = store.findDoc("user", null);

    expect(doc.status).toBe("idle");
    expect(doc.data).toBeUndefined();
    expect(doc.error).toBeUndefined();
    expect(doc.isPending).toBe(false);
    expect(doc.isFetching).toBe(false);
    expect(doc.hasData).toBe(false);
    expect(doc.fetchedAt).toBeUndefined();
    expect(doc.revision).toBeUndefined();
    expect(doc.promise).toBeUndefined();
    expect(userAdapter.find).not.toHaveBeenCalled();
  });

  it("satisfies the full idle invariant when id is undefined", () => {
    const { store, userAdapter } = makeStore();
    const doc = store.findDoc("user", undefined);

    expect(doc.status).toBe("idle");
    expect(doc.data).toBeUndefined();
    expect(doc.error).toBeUndefined();
    expect(doc.isPending).toBe(false);
    expect(doc.isFetching).toBe(false);
    expect(doc.hasData).toBe(false);
    expect(doc.fetchedAt).toBeUndefined();
    expect(doc.revision).toBeUndefined();
    expect(doc.promise).toBeUndefined();
    expect(userAdapter.find).not.toHaveBeenCalled();
  });

  it("satisfies the idle invariant when array ids is null", () => {
    const { store, userAdapter } = makeStore();
    // Explicit cast to the array overload's parameter type so TS routes
    // to the array form. In app code, a variable typed as `string[] | null`
    // (e.g. from a selector) routes naturally.
    const ids = null as readonly string[] | null | undefined;
    const docs = store.findDoc("user", ids);

    expect(docs.status).toBe("idle");
    expect(docs.items).toBeUndefined();
    expect(docs.error).toBeUndefined();
    expect(docs.isPending).toBe(false);
    expect(docs.isFetching).toBe(false);
    expect(docs.hasData).toBe(false);
    expect(docs.promise).toBeUndefined();
    expect(userAdapter.find).not.toHaveBeenCalled();
  });
});

// =============================================================================
// findDoc — array of ids
// =============================================================================

describe("findDoc (array of ids)", () => {
  it("returns a pending handle and resolves to an array of docs", async () => {
    const { store, userAdapter } = makeStore();
    const docs = store.findDoc("user", ["1", "2", "3"]);

    expect(docs.status).toBe("pending");
    expect(docs.isPending).toBe(true);
    expect(docs.items).toBeUndefined();

    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
    expect(docs.status).toBe("success");
    expect(docs.items).toHaveLength(3);
    expect(docs.items?.[0]?.firstName).toBe("User1");
    expect(docs.items?.[1]?.firstName).toBe("User2");
    expect(docs.items?.[2]?.firstName).toBe("User3");
  });

  it("shares the coalescer with single-id findDoc (one batched adapter call)", async () => {
    const { store, userAdapter } = makeStore();

    const single = store.findDoc("user", "1");
    const bulk = store.findDoc("user", ["1", "2"]);

    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
    const ids = (userAdapter.find as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ids).toEqual(expect.arrayContaining(["1", "2"]));
    expect(ids).toHaveLength(2);

    expect(single.data?.firstName).toBe("User1");
    expect(bulk.items).toHaveLength(2);
  });
});

// =============================================================================
// findDoc — refetch semantics
// =============================================================================

describe("findDoc refetch", () => {
  it("keeps isPending false across refetch, only toggling isFetching", async () => {
    const { store } = makeStore();
    const doc = store.findDoc("user", "1");
    await flushCoalescer();

    expect(doc.isPending).toBe(false);
    expect(doc.isFetching).toBe(false);
    expect(doc.hasData).toBe(true);

    doc.refetch();

    expect(doc.isPending).toBe(false);
    expect(doc.isFetching).toBe(true);
    expect(doc.hasData).toBe(true); // still shows prior data

    await flushCoalescer();

    expect(doc.isFetching).toBe(false);
    expect(doc.status).toBe("success");
  });

  it("refetch while a fetch is already in flight is a no-op (dedup)", async () => {
    const { store, userAdapter } = makeStore();
    const doc = store.findDoc("user", "1");

    // First fetch is in flight (pre-tick)
    doc.refetch();
    doc.refetch();

    await flushCoalescer();

    // Only one adapter call should have happened — refetches collapsed.
    expect(userAdapter.find).toHaveBeenCalledTimes(1);
  });

  it("updates fetchedAt on a successful refetch", async () => {
    const { store } = makeStore();
    const doc = store.findDoc("user", "1");
    await flushCoalescer();

    const first = doc.fetchedAt!;
    expect(first).toBeInstanceOf(Date);

    // Advance fake time so the next Date() differs
    vi.advanceTimersByTime(100);

    doc.refetch();
    await flushCoalescer();

    expect(doc.fetchedAt!.getTime()).toBeGreaterThan(first.getTime());
  });
});

// =============================================================================
// findDoc — errors
// =============================================================================

describe("findDoc errors", () => {
  it("surfaces adapter errors via the error field as an Error instance", async () => {
    const failingAdapter: DocumentAdapter<User> = {
      find: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const { store } = makeStore({
      adapters: {
        user: failingAdapter,
        post: makePostAdapter(),
      },
    });

    const doc = store.findDoc("user", "1");
    await flushCoalescer();

    expect(doc.status).toBe("error");
    expect(doc.error).toBeInstanceOf(Error);
    expect(doc.error?.message).toBe("boom");
    expect(doc.isFetching).toBe(false);
    expect(doc.isPending).toBe(false);
  });

  it("preserves the error across a subsequent successful insertDocument", async () => {
    const failingAdapter: DocumentAdapter<User> = {
      find: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const { store } = makeStore({
      adapters: {
        user: failingAdapter,
        post: makePostAdapter(),
      },
    });

    const doc = store.findDoc("user", "1");
    await flushCoalescer();
    expect(doc.status).toBe("error");

    // Direct insert recovers the handle
    store.insertDocument({
      type: "user",
      id: "1",
      attributes: { firstName: "Recovered", lastName: "X", email: "r@x" },
    });

    expect(doc.status).toBe("success");
    expect(doc.error).toBeUndefined();
    expect(doc.data?.firstName).toBe("Recovered");
  });
});

// =============================================================================
// findDoc — stable .promise for React.use()
// =============================================================================

describe("findDoc .promise", () => {
  it("is a Promise that resolves to the doc data on first load", async () => {
    const { store } = makeStore();
    const doc = store.findDoc("user", "1");

    expect(doc.promise).toBeInstanceOf(Promise);

    await flushCoalescer();

    const data = await doc.promise!;
    expect(data.firstName).toBe("User1");
  });

  it("is stable across refetch (does not create a new promise)", async () => {
    const { store } = makeStore();
    const doc = store.findDoc("user", "1");
    await flushCoalescer();

    const first = doc.promise;
    doc.refetch();

    expect(doc.promise).toBe(first);
  });

  it("rejects once on initial error", async () => {
    const failingAdapter: DocumentAdapter<User> = {
      find: vi.fn(async () => {
        throw new Error("nope");
      }),
    };
    const { store } = makeStore({
      adapters: {
        user: failingAdapter,
        post: makePostAdapter(),
      },
    });

    const doc = store.findDoc("user", "1");
    const p = doc.promise;

    await flushCoalescer();

    expect(doc.status).toBe("error");
    await expect(p).rejects.toThrow("nope");
  });

  it("creates a NEW .promise on successful refetch after an error", async () => {
    let callCount = 0;
    const flakyAdapter: DocumentAdapter<User> = {
      find: vi.fn(async (ids: string[]) => {
        callCount++;
        if (callCount === 1) throw new Error("first-fail");
        return {
          data: ids.map((id) => ({
            type: "user",
            id,
            attributes: {
              firstName: "Recovered",
              lastName: "X",
              email: "r@x",
            },
            meta: { revision: 2 },
          })),
        };
      }),
    };
    const { store } = makeStore({
      adapters: { user: flakyAdapter, post: makePostAdapter() },
    });

    const doc = store.findDoc("user", "1");
    const firstPromise = doc.promise;
    await flushCoalescer();

    expect(doc.status).toBe("error");
    // Swallow the rejection so the test runner doesn't treat it as unhandled
    await firstPromise?.catch(() => {});

    doc.refetch();
    await flushCoalescer();

    expect(doc.status).toBe("success");
    expect(doc.promise).not.toBe(firstPromise);
    const data = await doc.promise!;
    expect(data.firstName).toBe("Recovered");
  });
});
