import { Effect, Schedule } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  AdapterError,
  createDocumentStore,
  type DocumentStore,
  type DocumentAdapter,
  type QueryAdapter,
} from "../src";
import { Finder, type InternalHandle, type InternalState } from "../src/finder";
import { makeIdleHandle } from "../src/transitions";
import { setupFakeTimers } from "./setup/timers";

/**
 * Wrap a Promise-returning function as an adapter `find` that returns an
 * `Effect`, failing with `AdapterError` (mirrors the example-app adapters).
 */
function effectFind<A extends ReadonlyArray<unknown>>(
  type: string,
  fn: (...args: A) => Promise<unknown>,
): (...args: A) => Effect.Effect<unknown, AdapterError> {
  return (...args: A) =>
    Effect.tryPromise({
      try: () => fn(...args),
      catch: (cause) => new AdapterError({ type, keys: [], cause }),
    });
}

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
    find: effectFind("user", async (ids: Array<string>) => {
      calls.push([...ids]);
      if (adapter.failIds && ids.some((id) => adapter.failIds!.has(id))) {
        throw new Error("adapter rejected");
      }
      return ids.filter((id) => !adapter.omitIds?.has(id)).map((id) => ({ id, name: `User${id}` }));
    }),
  };
  return adapter;
}

function makePostAdapter(): IntrospectableAdapter {
  const calls: string[][] = [];
  const adapter: IntrospectableAdapter = {
    calls,
    find: effectFind("post", async (ids: Array<string>) => {
      calls.push([...ids]);
      return ids.map((id) => ({ id, title: `Post${id}` }));
    }),
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
    // Disable the built-in fibonacci default retry so failure assertions
    // surface immediately (resilience.test.ts covers retry behavior).
    retry: Schedule.recurs(0),
    ...(opts.batchWindowMs !== undefined && { batchWindowMs: opts.batchWindowMs }),
    ...(opts.batchSize !== undefined && { batchSize: opts.batchSize }),
  };
  const store = createDocumentStore<TestTypes>(config);
  return { store, userAdapter, postAdapter };
}

async function flushBatch(ms = 20): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

setupFakeTimers();

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

    expect(h1.error).toBeDefined();
    expect(h2.error).toBeDefined();
    expect(h3.error).toBeDefined();
    expect(h1.error).toBeInstanceOf(AdapterError);
    const cause = (h1.error as AdapterError).cause;
    expect((cause as Error).message).toMatch(/adapter rejected/);
  });

  it("rejects a handle when the adapter returns without the requested id", async () => {
    const app = makeStore();
    // Ask for 1, 2, 3 but the adapter's response omits id "2".
    app.userAdapter.omitIds = new Set(["2"]);

    const h1 = app.store.find("user", "1");
    const h2 = app.store.find("user", "2");
    const h3 = app.store.find("user", "3");

    await flushBatch();

    expect(h1.value).not.toBeUndefined();
    expect(h2.value === undefined && h2.error !== undefined).toBe(true);
    expect(h2.error?.message).toMatch(/not found/i);
    expect(h3.value).not.toBeUndefined();
  });

  it("rejects all pending handles when a processor throws", async () => {
    // A DocumentStore with a processor that throws for the user model.
    const calls: string[][] = [];
    const store = createDocumentStore<TestTypes>({
      models: {
        user: {
          adapter: {
            find: effectFind("user", async (ids: Array<string>) => {
              calls.push([...ids]);
              return ids.map((id) => ({ id, name: `User${id}` }));
            }),
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

    expect(h1.error).toBeDefined();
    expect(h2.error).toBeDefined();
    const cause = (h1.error as { cause?: unknown }).cause;
    expect((cause as Error).message).toMatch(/processor exploded/);
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
            find: effectFind("user", async (ids: Array<string>) => {
              calls.push([...ids]);
              return Promise.all(ids.map(async (id) => ({ id, name: `User${id}` })));
            }),
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
    expect(h1.value?.name).toBe("User1");
    expect(h2.value?.name).toBe("User2");
    expect(h3.value?.name).toBe("User3");
  });
});

describe("Finder handles query-only batches", () => {
  it("drains queued queries without requiring any document requests", async () => {
    type Types = { user: { id: string; name: string } };
    type Queries = { search: { params: { q: string }; result: { total: number } } };

    const queryCalls: Array<ReadonlyArray<{ q: string }>> = [];
    const queryAdapter: QueryAdapter<{ q: string }> = {
      find: effectFind("search", async (paramsList: Array<{ q: string }>) => {
        queryCalls.push(paramsList);
        return paramsList.map(() => ({ total: 42 }));
      }),
    };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: makeUserAdapter() } },
      queries: { search: { adapter: queryAdapter } },
    });

    const h = store.findQuery("search", { q: "hello" });
    await flushBatch();

    expect(h.value).not.toBeUndefined();
    expect(h.value?.total).toBe(42);
    expect(queryCalls).toHaveLength(1);
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
            find: effectFind("search", async () => {
              throw "plain-string-error";
            }),
          },
        },
      },
      retry: Schedule.recurs(0),
    });

    const h = store.findQuery("search", { q: "oops" });
    await flushBatch();
    await h.promise?.catch(() => {});

    expect(h.error).toBeDefined();
    expect(h.error).toBeInstanceOf(AdapterError);
    expect((h.error as AdapterError).cause).toBe("plain-string-error");
  });

  it("wraps a non-Error document adapter rejection in an Error", async () => {
    const store = createDocumentStore<TestTypes>({
      models: {
        user: {
          adapter: {
            find: effectFind("user", async () => {
              throw "document-string-error";
            }),
          },
        },
        post: { adapter: makePostAdapter() },
      },
      retry: Schedule.recurs(0),
    });

    const h = store.find("user", "1");
    await flushBatch();

    expect(h.error).toBeDefined();
    expect(h.error).toBeInstanceOf(AdapterError);
    expect((h.error as AdapterError).cause).toBe("document-string-error");
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
            find: effectFind("user", async (ids: Array<string>) =>
              ids.map((id) => ({ id, name: `User${id}` })),
            ),
          },
        },
        post: { adapter: makePostAdapter() },
      },
      queries: {
        search: {
          adapter: {
            find: effectFind("search", async (paramsList: Array<{ q: string }>) =>
              paramsList.map(() => ({ total: 1 })),
            ),
          },
        },
      },
    });
    const finder = new Finder<TestTypes, Queries>({
      retry: Schedule.recurs(0),
      models: {
        user: {
          adapter: {
            find: effectFind("user", async (ids: Array<string>) => {
              documentCalls.push([...ids]);
              return ids.map((id) => ({ id, name: `User${id}` }));
            }),
          },
        },
        post: { adapter: makePostAdapter() },
      },
      queries: {
        search: {
          adapter: {
            find: effectFind("search", async (paramsList: Array<{ q: string }>) => {
              queryCalls.push([...paramsList]);
              return paramsList.map(() => ({ total: 1 }));
            }),
          },
        },
      },
    });

    finder.attach({ documents: new Map(), queries: new Map() }, store);
    finder.queueDocument("user", "1");
    finder.queueDocument("user", "1");
    finder.queueQuery("search", "same-query", { q: "hello" });
    finder.queueQuery("search", "same-query", { q: "hello" });

    await finder.drain();

    expect(documentCalls).toEqual([["1"]]);
    expect(queryCalls).toEqual([[{ q: "hello" }]]);
  });

  it("allows an empty drain", async () => {
    const finder = new Finder<TestTypes>({
      retry: Schedule.recurs(0),
      models: {
        user: { adapter: makeUserAdapter() },
        post: { adapter: makePostAdapter() },
      },
    });

    finder.attach({ documents: new Map(), queries: new Map() }, {} as DocumentStore<TestTypes>);

    await expect(finder.drain()).resolves.toBeUndefined();
  });

  it("ignores a queued query when no query adapter is configured", async () => {
    const finder = new Finder<TestTypes>({
      retry: Schedule.recurs(0),
      models: {
        user: { adapter: makeUserAdapter() },
        post: { adapter: makePostAdapter() },
      },
    });

    finder.attach({ documents: new Map(), queries: new Map() }, {} as DocumentStore<TestTypes>);
    finder.queueQuery("missing" as never, "params", { q: "missing" } as never);

    await expect(finder.drain()).resolves.toBeUndefined();
  });

  // Helpers shared by the "handle removed mid-flight" scenarios below.
  function pendingHandle(): InternalHandle {
    const handle = makeIdleHandle();
    // A fetch is in flight: no value yet, isFetching true, with resolver
    // spies so we can assert they're never invoked once the handle is orphaned.
    handle.isFetching = true;
    handle.resolve = vi.fn<(v: unknown) => void>();
    handle.reject = vi.fn<(e: unknown) => void>();
    return handle;
  }

  function expectUntouched(handle: InternalHandle): void {
    expect(handle.value).toBeUndefined();
    expect(handle.error).toBeUndefined();
    expect(handle.isFetching).toBe(true);
    expect(handle.resolve).not.toHaveBeenCalled();
    expect(handle.reject).not.toHaveBeenCalled();
  }

  it("does not resolve a removed handle when drain succeeds", async () => {
    type Queries = { search: { params: { q: string }; result: { total: number } } };

    const documentCalls: string[][] = [];
    const queryCalls: Array<Array<{ q: string }>> = [];

    const documentHandle = pendingHandle();
    const queryHandle = pendingHandle();
    const state: InternalState = {
      documents: new Map([["user", new Map([["1", documentHandle]])]]),
      queries: new Map([["search", new Map([["search-key", queryHandle]])]]),
    };

    const store = createDocumentStore<TestTypes, Queries>({
      models: { user: { adapter: makeUserAdapter() }, post: { adapter: makePostAdapter() } },
      queries: { search: { adapter: { find: effectFind("search", async () => []) } } },
    });

    const finder = new Finder<TestTypes, Queries>({
      retry: Schedule.recurs(0),
      models: {
        user: {
          adapter: {
            find: effectFind("user", async (ids: Array<string>) => {
              documentCalls.push([...ids]);
              return ids.map((id) => ({ id, name: `User${id}` }));
            }),
          },
        },
        post: { adapter: makePostAdapter() },
      },
      queries: {
        search: {
          adapter: {
            find: effectFind("search", async (paramsList: Array<{ q: string }>) => {
              queryCalls.push([...paramsList]);
              return paramsList.map(() => ({ total: 1 }));
            }),
          },
        },
      },
    });

    finder.attach(state, store);
    finder.queueDocument("user", "1");
    finder.queueQuery("search", "search-key", { q: "hello" });

    // Caller drops the waiting handles before drain reaches the resolve
    // step (e.g. component unmounted, or a fresh fetch replaced the slot).
    state.documents.get("user")!.delete("1");
    state.queries.get("search")!.delete("search-key");

    await finder.drain();

    // The fetch still ran — drain doesn't know the handle is gone.
    expect(documentCalls).toEqual([["1"]]);
    expect(queryCalls).toEqual([[{ q: "hello" }]]);

    // The orphaned handles must not be mutated and their pending promise
    // must not be resolved — whoever held them moved on.
    expectUntouched(documentHandle);
    expectUntouched(queryHandle);
  });

  it("does not reject a removed handle when the adapter throws", async () => {
    type Queries = { search: { params: { q: string }; result: { total: number } } };

    const documentHandle = pendingHandle();
    const queryHandle = pendingHandle();
    const state: InternalState = {
      documents: new Map([["user", new Map([["1", documentHandle]])]]),
      queries: new Map([["search", new Map([["search-key", queryHandle]])]]),
    };

    const store = createDocumentStore<TestTypes, Queries>({
      models: { user: { adapter: makeUserAdapter() }, post: { adapter: makePostAdapter() } },
      queries: { search: { adapter: { find: effectFind("search", async () => []) } } },
    });

    const finder = new Finder<TestTypes, Queries>({
      retry: Schedule.recurs(0),
      models: {
        user: {
          adapter: {
            find: effectFind("user", async () => {
              throw new Error("document fetch failed");
            }),
          },
        },
        post: { adapter: makePostAdapter() },
      },
      queries: {
        search: {
          adapter: {
            find: effectFind("search", async () => {
              throw new Error("query fetch failed");
            }),
          },
        },
      },
    });

    finder.attach(state, store);
    finder.queueDocument("user", "1");
    finder.queueQuery("search", "search-key", { q: "hello" });

    // Caller drops the waiting handles before the adapter rejection lands.
    state.documents.get("user")!.delete("1");
    state.queries.get("search")!.delete("search-key");

    await finder.drain();

    // The rejection path must not touch orphaned handles.
    expectUntouched(documentHandle);
    expectUntouched(queryHandle);
  });
});

// =============================================================================
// Adapter boundary: Promise-first, Effect opt-in
//
// The public contract accepts a Promise (the common case) OR an Effect. The
// finder normalizes both onto its Effect engine; a Promise rejection becomes
// an AdapterError (passed through untouched if the adapter already threw one).
// =============================================================================

describe("adapter boundary (Promise | Effect)", () => {
  function storeWithUserFind(find: DocumentAdapter["find"]): DocumentStore<TestTypes> {
    return createDocumentStore<TestTypes>({
      models: {
        user: { adapter: { find } },
        post: { adapter: makePostAdapter() },
      },
      retry: Schedule.recurs(0),
    });
  }

  it("accepts a Promise-returning adapter (no Effect) and populates the handle", async () => {
    const store = storeWithUserFind(async (ids) => ids.map((id) => ({ id, name: `User${id}` })));
    const h = store.find("user", "1");

    await flushBatch();

    expect(h.value?.name).toBe("User1");
    expect(h.status).toBe("success");
  });

  it("wraps a Promise rejection into an AdapterError (cause preserved)", async () => {
    const boom = new Error("network down");
    const store = storeWithUserFind(async () => {
      throw boom;
    });
    const h = store.find("user", "1");

    await flushBatch();

    expect(h.error).toBeInstanceOf(AdapterError);
    expect((h.error as AdapterError).cause).toBe(boom);
    expect((h.error as AdapterError).keys).toEqual(["1"]);
  });

  it("passes an AdapterError thrown by a Promise adapter through untouched (no double-wrap)", async () => {
    const original = new AdapterError({ type: "user", keys: ["1"], cause: "explicit" });
    const store = storeWithUserFind(async () => {
      throw original;
    });
    const h = store.find("user", "1");

    await flushBatch();

    expect(h.error).toBe(original);
  });

  it("still accepts an Effect-returning adapter as-is", async () => {
    const store = storeWithUserFind((ids) =>
      Effect.succeed(ids.map((id) => ({ id, name: `User${id}` }))),
    );
    const h = store.find("user", "1");

    await flushBatch();

    expect(h.value?.name).toBe("User1");
  });
});
