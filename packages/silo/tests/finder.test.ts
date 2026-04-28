import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDocumentStore, type DocumentStore, type DocumentAdapter } from "../src";
import { Finder, type InternalState } from "../src/finder";

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

describe("Finder handles query-only batches", () => {
  it("drains queued queries without requiring any document requests", async () => {
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
    expect(queryAdapter.calls).toHaveLength(1);
  });
});

describe("Finder normalizes adapter failures", () => {
  it("wraps a non-Error query adapter rejection in an Error", async () => {
    type Types = { user: { id: string; name: string } };
    type Queries = { search: { params: { q: string }; result: { total: number } } };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: makeUserAdapter() } },
      queries: {
        search: {
          adapter: {
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
    expect(h.error).toBeInstanceOf(Error);
    expect(h.error?.message).toBe("plain-string-error");
  });

  it("wraps a non-Error document adapter rejection in an Error", async () => {
    const store = createDocumentStore<TestTypes>({
      models: {
        user: {
          adapter: {
            async find() {
              throw "document-string-error";
            },
          },
        },
        post: { adapter: makePostAdapter() },
      },
    });

    const h = store.find("user", "1");
    await flushBatch();

    expect(h.status).toBe("ERROR");
    expect(h.error).toBeInstanceOf(Error);
    expect(h.error?.message).toBe("document-string-error");
  });
});

describe("Finder empty queues and orphaned handles", () => {
  it("deduplicates repeated document ids and query params within one drain", async () => {
    type Queries = { search: { params: { q: string }; result: { total: number } } };
    const documentCalls: string[][] = [];
    const queryCalls: Array<Array<unknown>> = [];
    const store = createDocumentStore<TestTypes, Queries>({
      models: {
        user: {
          adapter: {
            async find(ids) {
              return ids.map((id) => ({ id, name: `User${id}` }));
            },
          },
        },
        post: { adapter: makePostAdapter() },
      },
      queries: {
        search: {
          adapter: {
            async find(paramsList) {
              return paramsList.map(() => ({ total: 1 }));
            },
          },
        },
      },
    });
    const finder = new Finder<TestTypes, Queries>({
      models: {
        user: {
          adapter: {
            async find(ids) {
              documentCalls.push([...ids]);
              return ids.map((id) => ({ id, name: `User${id}` }));
            },
          },
        },
        post: { adapter: makePostAdapter() },
      },
      queries: {
        search: {
          adapter: {
            async find(paramsList) {
              queryCalls.push([...paramsList]);
              return paramsList.map(() => ({ total: 1 }));
            },
          },
        },
      },
    });

    finder.attach({ documents: new Map(), queries: new Map() }, store);
    finder.queueDocument("user", "1");
    finder.queueDocument("user", "1");
    finder.queueQuery("search", "same-query", { q: "hello" });
    finder.queueQuery("search", "same-query", { q: "hello" });

    await (finder as unknown as { drain(): Promise<void> }).drain();

    expect(documentCalls).toEqual([["1"]]);
    expect(queryCalls).toEqual([[{ q: "hello" }]]);
  });

  it("allows an empty drain", async () => {
    const finder = new Finder<TestTypes>({
      models: {
        user: { adapter: makeUserAdapter() },
        post: { adapter: makePostAdapter() },
      },
    });

    finder.attach({ documents: new Map(), queries: new Map() }, {} as DocumentStore<TestTypes>);

    await expect(
      (finder as unknown as { drain(): Promise<void> }).drain(),
    ).resolves.toBeUndefined();
  });

  it("ignores a queued query when no query adapter is configured", async () => {
    const finder = new Finder<TestTypes>({
      models: {
        user: { adapter: makeUserAdapter() },
        post: { adapter: makePostAdapter() },
      },
    });

    finder.attach({ documents: new Map(), queries: new Map() }, {} as DocumentStore<TestTypes>);
    finder.queueQuery("missing" as never, "params", { q: "missing" } as never);

    await expect(
      (finder as unknown as { drain(): Promise<void> }).drain(),
    ).resolves.toBeUndefined();
  });

  it("ignores queued work when the waiting handle was removed before drain", async () => {
    type Queries = { search: { params: { q: string }; result: { total: number } } };
    const documentCalls: string[][] = [];
    const queryCalls: Array<Array<{ q: string }>> = [];
    const state: InternalState = { documents: new Map(), queries: new Map() };
    const store = createDocumentStore<TestTypes, Queries>({
      models: {
        user: {
          adapter: {
            async find(ids) {
              documentCalls.push([...ids]);
              return ids.map((id) => ({ id, name: `User${id}` }));
            },
          },
        },
        post: { adapter: makePostAdapter() },
      },
      queries: {
        search: {
          adapter: {
            async find(paramsList) {
              queryCalls.push([...paramsList]);
              return paramsList.map(() => ({ total: 1 }));
            },
          },
        },
      },
    });
    const finder = new Finder<TestTypes, Queries>({
      models: {
        user: {
          adapter: {
            async find(ids) {
              documentCalls.push([...ids]);
              return ids.map((id) => ({ id, name: `User${id}` }));
            },
          },
        },
        post: { adapter: makePostAdapter() },
      },
      queries: {
        search: {
          adapter: {
            async find(paramsList) {
              queryCalls.push([...paramsList]);
              return paramsList.map(() => ({ total: 1 }));
            },
          },
        },
      },
    });

    finder.attach(state, store);
    finder.queueDocument("user", "1");
    finder.queueQuery("search", "search-key", { q: "hello" });

    await (finder as unknown as { drain(): Promise<void> }).drain();

    expect(documentCalls).toEqual([["1"]]);
    expect(queryCalls).toEqual([[{ q: "hello" }]]);
  });

  it("ignores rejected chunks when the waiting handle was removed before rejection", () => {
    const finder = new Finder<TestTypes>({
      models: {
        user: { adapter: makeUserAdapter() },
        post: { adapter: makePostAdapter() },
      },
      queries: {
        search: { adapter: { find: async () => [] } },
      },
    } as never);

    finder.attach({ documents: new Map(), queries: new Map() }, {} as DocumentStore<TestTypes>);

    expect(() =>
      (
        finder as unknown as {
          rejectDocumentChunk(type: string, ids: Array<string>, error: unknown): void;
        }
      ).rejectDocumentChunk("user", ["missing"], "document failure"),
    ).not.toThrow();
    expect(() =>
      (
        finder as unknown as {
          rejectQueryChunk(
            type: string,
            chunk: Array<{ paramsKey: string; params: unknown }>,
            error: unknown,
          ): void;
        }
      ).rejectQueryChunk("search", [{ paramsKey: "missing", params: {} }], "query failure"),
    ).not.toThrow();
  });
});
