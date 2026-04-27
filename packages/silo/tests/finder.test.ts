import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDocumentStore, type DocumentStore, type DocumentAdapter } from "../src";

// =============================================================================
// Finder contract tests.
//
// Finder is internal (not exported from @supergrain/silo). These
// tests exercise its behavior through the public DocumentStore API: batching
// within a tick window, dedup of concurrent same-id requests, chunking at
// batchSize, and error propagation from adapter/processor.
//
// No MSW, no network. Each adapter is a real, in-process implementation that
// records the `ids` it was called with as part of its own public state
// (`calls: string[][]`). That isn't a spy or mock — it's a real adapter
// whose behavior is fully inspectable. Assertions check the adapter's own
// recorded state and the observable outcomes of `store.find(...)`.
//
// Request-count / URL-shape assertions (i.e. "1 bulk GET" vs "3 fan-out GETs")
// belong in adapter.test.ts — that's the adapter's concern, not Finder's.
// =============================================================================

type TestTypes = {
  user: { id: string; name: string };
  post: { id: string; title: string };
};

interface IntrospectableAdapter extends DocumentAdapter {
  /** Every `ids` array this adapter has been called with, in order. */
  readonly calls: ReadonlyArray<ReadonlyArray<string>>;
  /** Trigger for a specific id to fail (returns a rejected Promise). */
  failIds?: Set<string>;
  /** When set, `find` omits these ids from its response (simulates "not found"). */
  omitIds?: Set<string>;
}

function makeUserAdapter(): IntrospectableAdapter {
  const calls: string[][] = [];
  const adapter: IntrospectableAdapter = {
    calls,
    async find(ids) {
      calls.push([...ids]);
      if (adapter.failIds && ids.some((id) => adapter.failIds!.has(id))) {
        throw new Error("adapter rejected");
      }
      return ids.filter((id) => !adapter.omitIds?.has(id)).map((id) => ({ id, name: `User${id}` }));
    },
  };
  return adapter;
}

function makePostAdapter(): IntrospectableAdapter {
  const calls: string[][] = [];
  const adapter: IntrospectableAdapter = {
    calls,
    async find(ids) {
      calls.push([...ids]);
      return ids.map((id) => ({ id, title: `Post${id}` }));
    },
  };
  return adapter;
}

interface TestApp {
  store: DocumentStore<TestTypes>;
  userAdapter: IntrospectableAdapter;
  postAdapter: IntrospectableAdapter;
}

function makeStore(opts: { batchWindowMs?: number; batchSize?: number } = {}): TestApp {
  const userAdapter = makeUserAdapter();
  const postAdapter = makePostAdapter();
  const config = {
    models: {
      user: { adapter: userAdapter },
      post: { adapter: postAdapter },
    },
    ...(opts.batchWindowMs !== undefined && { batchWindowMs: opts.batchWindowMs }),
    ...(opts.batchSize !== undefined && { batchSize: opts.batchSize }),
  };
  const store = createDocumentStore<TestTypes>(config);
  return { store, userAdapter, postAdapter };
}

async function flushBatch(ms = 20): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// =============================================================================
// Batching within the tick window
// =============================================================================

describe("Finder batching", () => {
  it("collapses N finds of the same type within the window into one adapter.find call", async () => {
    const app = makeStore();
    app.store.find("user", "1");
    app.store.find("user", "2");
    app.store.find("user", "3");

    await flushBatch();

    expect(app.userAdapter.calls).toHaveLength(1);
    expect([...app.userAdapter.calls[0]].sort()).toEqual(["1", "2", "3"]);
  });

  it("starts a fresh batch after the previous window drains", async () => {
    const app = makeStore();
    app.store.find("user", "1");
    await flushBatch();
    app.store.find("user", "2");
    await flushBatch();

    expect(app.userAdapter.calls).toHaveLength(2);
    expect(app.userAdapter.calls[0]).toEqual(["1"]);
    expect(app.userAdapter.calls[1]).toEqual(["2"]);
  });

  it("respects a custom batchWindowMs", async () => {
    const app = makeStore({ batchWindowMs: 50 });
    app.store.find("user", "1");

    await vi.advanceTimersByTimeAsync(20);
    expect(app.userAdapter.calls).toHaveLength(0); // window hasn't elapsed

    await vi.advanceTimersByTimeAsync(40);
    expect(app.userAdapter.calls).toHaveLength(1);
  });

  it("fires separate adapter calls per type in the same window", async () => {
    const app = makeStore();
    app.store.find("user", "1");
    app.store.find("post", "1");
    await flushBatch();

    expect(app.userAdapter.calls).toHaveLength(1);
    expect(app.postAdapter.calls).toHaveLength(1);
    expect(app.userAdapter.calls[0]).toEqual(["1"]);
    expect(app.postAdapter.calls[0]).toEqual(["1"]);
  });
});

// =============================================================================
// Dedup — concurrent finds for the same (type, id) share one adapter call + promise
// =============================================================================

describe("Finder dedup", () => {
  it("concurrent same-id finds result in a single adapter call with that id once", async () => {
    const app = makeStore();
    app.store.find("user", "1");
    app.store.find("user", "1");
    app.store.find("user", "1");

    await flushBatch();

    expect(app.userAdapter.calls).toHaveLength(1);
    expect(app.userAdapter.calls[0]).toEqual(["1"]);
  });

  it("mid-window additions to an in-flight id don't re-request", async () => {
    const app = makeStore();
    app.store.find("user", "1");
    await vi.advanceTimersByTimeAsync(10); // mid-window
    app.store.find("user", "1");

    await flushBatch();

    expect(app.userAdapter.calls).toHaveLength(1);
    expect(app.userAdapter.calls[0]).toEqual(["1"]);
  });

  it("handles returned for concurrent same-id finds are the same object", () => {
    const app = makeStore();
    const h1 = app.store.find("user", "1");
    const h2 = app.store.find("user", "1");
    expect(h1).toBe(h2);
  });
});

// =============================================================================
// Chunking — one adapter call per chunk of at most batchSize ids
// =============================================================================

describe("Finder chunking", () => {
  it("splits 150 ids at the default batchSize 60 into 3 adapter calls", async () => {
    const app = makeStore();
    for (let i = 0; i < 150; i++) {
      app.store.find("user", String(i));
    }

    await flushBatch();

    expect(app.userAdapter.calls).toHaveLength(3);
    const lens = app.userAdapter.calls.map((c) => c.length).sort((a, b) => b - a);
    expect(lens).toEqual([60, 60, 30]);
  });

  it("respects a custom batchSize", async () => {
    const app = makeStore({ batchSize: 10 });
    for (let i = 0; i < 25; i++) {
      app.store.find("user", String(i));
    }

    await flushBatch();

    expect(app.userAdapter.calls).toHaveLength(3);
    const lens = app.userAdapter.calls.map((c) => c.length).sort((a, b) => b - a);
    expect(lens).toEqual([10, 10, 5]);
  });
});

// =============================================================================
// Error propagation — adapter rejections, missing docs, processor throws
// =============================================================================

describe("Finder errors", () => {
  it("rejects all pending handles in a chunk when the adapter rejects", async () => {
    const app = makeStore();
    app.userAdapter.failIds = new Set(["1"]);

    const h1 = app.store.find("user", "1");
    const h2 = app.store.find("user", "2");
    const h3 = app.store.find("user", "3");

    await flushBatch();

    expect(h1.status).toBe("ERROR");
    expect(h2.status).toBe("ERROR");
    expect(h3.status).toBe("ERROR");
    expect(h1.error?.message).toMatch(/adapter rejected/);
  });

  it("rejects a handle when the adapter returns without the requested id", async () => {
    const app = makeStore();
    // Ask for 1, 2, 3 but the adapter's response omits id "2".
    app.userAdapter.omitIds = new Set(["2"]);

    const h1 = app.store.find("user", "1");
    const h2 = app.store.find("user", "2");
    const h3 = app.store.find("user", "3");

    await flushBatch();

    expect(h1.status).toBe("SUCCESS");
    expect(h2.status).toBe("ERROR");
    expect(h2.error?.message).toMatch(/not found/i);
    expect(h3.status).toBe("SUCCESS");
  });

  it("rejects all pending handles when a processor throws", async () => {
    // A DocumentStore with a processor that throws for the user model.
    const calls: string[][] = [];
    const store = createDocumentStore<TestTypes>({
      models: {
        user: {
          adapter: {
            async find(ids) {
              calls.push([...ids]);
              return ids.map((id) => ({ id, name: `User${id}` }));
            },
          },
          processor: () => {
            throw new Error("processor exploded");
          },
        },
        post: { adapter: makePostAdapter() },
      },
    });

    const h1 = store.find("user", "1");
    const h2 = store.find("user", "2");

    await flushBatch();

    expect(h1.status).toBe("ERROR");
    expect(h2.status).toBe("ERROR");
    expect(h1.error?.message).toMatch(/processor exploded/);
  });
});

// =============================================================================
// Pipeline works regardless of how the adapter fulfills find(ids).
// =============================================================================

describe("Finder is adapter-agnostic", () => {
  it("works with an adapter that fans out per id (fake async per-id fetch)", async () => {
    // A minimal fan-out adapter: Promise.all of per-id async tasks. Finder
    // still batches at its layer — this adapter receives one call with
    // all 3 ids, and internally resolves them in parallel.
    const calls: string[][] = [];
    const store = createDocumentStore<TestTypes>({
      models: {
        user: {
          adapter: {
            async find(ids) {
              calls.push([...ids]);
              return Promise.all(ids.map(async (id) => ({ id, name: `User${id}` })));
            },
          },
        },
        post: { adapter: makePostAdapter() },
      },
    });

    const h1 = store.find("user", "1");
    const h2 = store.find("user", "2");
    const h3 = store.find("user", "3");

    await flushBatch();

    expect(calls).toHaveLength(1);
    expect([...calls[0]].sort()).toEqual(["1", "2", "3"]);
    expect(h1.data?.name).toBe("User1");
    expect(h2.data?.name).toBe("User2");
    expect(h3.data?.name).toBe("User3");
  });
});

// =============================================================================
// Coverage gaps — query-only drain and non-Error rejection in queries
// =============================================================================

describe("Finder — query-only drain (line 105 empty documentGroups)", () => {
  it("drains only queries when no documents are queued (documentGroups is empty)", async () => {
    // This exercises the for-of loop on documentGroups when it has zero entries.
    // Only queries are in the queue so the documentGroups loop body never fires.
    type Types = { user: { id: string; name: string } };
    type Queries = { search: { params: { q: string }; result: { total: number } } };

    const queryAdapter: { find: (p: unknown[]) => Promise<unknown>; calls: unknown[][] } = {
      calls: [],
      async find(paramsList) {
        this.calls.push(paramsList);
        return paramsList.map(() => ({ total: 42 }));
      },
    };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: makeUserAdapter() } },
      queries: { search: { adapter: queryAdapter } },
    });

    const h = store.findQuery("search", { q: "hello" });
    await flushBatch();

    expect(h.status).toBe("SUCCESS");
    expect(h.data?.total).toBe(42);
    // Document adapter should NOT have been called (no documents queued)
    expect(queryAdapter.calls).toHaveLength(1);
  });
});

describe("Finder — non-Error query rejection (line 261 non-Error branch)", () => {
  it("wraps a non-Error query adapter rejection in a new Error", async () => {
    type Types = { user: { id: string; name: string } };
    type Queries = { search: { params: { q: string }; result: { total: number } } };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: makeUserAdapter() } },
      queries: {
        search: {
          adapter: {
            // Reject with a plain string, not an Error instance
            async find() {
              throw "plain-string-error";
            },
          },
        },
      },
    });

    const h = store.findQuery("search", { q: "oops" });
    await flushBatch();
    await h.promise?.catch(() => {});

    expect(h.status).toBe("ERROR");
    // The non-Error string was coerced to an Error instance (line 261)
    expect(h.error).toBeInstanceOf(Error);
    expect(h.error?.message).toBe("plain-string-error");
  });
});
