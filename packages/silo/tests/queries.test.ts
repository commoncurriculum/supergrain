// =============================================================================
// tests/queries.test.ts
// =============================================================================
//
// Pins the behavior of queries — the second surface on `DocumentStore`,
// parallel to documents but keyed by structured params objects instead of
// `id: string`. Covers:
//
//   - findQuery: memory-first; fetches on miss via the finder; stable
//     handle identity for deep-equal params.
//   - insertQueryResult: explicit params, writes at the stringified slot,
//     triggers reactive re-renders.
//   - findQueryInMemory: direct read; reactive.
//   - Finder pipeline: object params flow through to the adapter raw
//     (not stringified); dedup across deep-equal params; batching.
//   - Shared memory: query processors can normalize nested entities into
//     the documents cache via store.insertDocument; documents and queries
//     coexist independently.
//
// Uses the real `DocumentStore` (not a fake) — these are failing tests that
// pin the contract the implementation must meet.
// =============================================================================

import { effect } from "@supergrain/kernel";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Finder, type InternalState } from "../src/finder";
import { createDocumentStore } from "../src/store";
import {
  API_BASE,
  clearRequests,
  flushCoalescer,
  initStore,
  makeDashboard,
  makeUser,
  requests,
  server,
  type DashboardParams,
  type TypeToModel,
  type TypeToQuery,
} from "./example-app";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  clearRequests();
});
afterAll(() => server.close());

beforeEach(() => {
  vi.useFakeTimers();
});

// =============================================================================
// findQuery — reactive handle, stable identity, network on miss
// =============================================================================

describe("DocumentStore.findQuery", () => {
  it("returns an idle handle when params is null", () => {
    const store = initStore();
    const handle = store.findQuery("dashboard", null);

    expect(handle.status).toBe("IDLE");
    expect(handle.data).toBeUndefined();
    expect(handle.promise).toBeUndefined();
  });

  it("returns the same handle for repeat calls with deep-equal params", () => {
    const store = initStore();
    const p1: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const p2: DashboardParams = { workspaceId: 7, filters: { active: true } };
    expect(p1).not.toBe(p2); // sanity — different references

    const h1 = store.findQuery("dashboard", p1);
    const h2 = store.findQuery("dashboard", p2);

    expect(h1).toBe(h2);
  });

  it("returns different handles for different params", () => {
    const store = initStore();
    const h7 = store.findQuery("dashboard", { workspaceId: 7, filters: { active: true } });
    const h8 = store.findQuery("dashboard", { workspaceId: 8, filters: { active: true } });

    expect(h7).not.toBe(h8);
  });

  it("fetches the query via the adapter and caches the result", async () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };

    const handle = store.findQuery("dashboard", params);
    expect(handle.status).toBe("PENDING");

    await flushCoalescer();
    await handle.promise;

    // Per the dashboard MSW handler, totalActiveUsers encodes the workspaceId.
    expect(handle.status).toBe("SUCCESS");
    expect(handle.data?.totalActiveUsers).toBe(70);
    expect(store.findQueryInMemory("dashboard", params)?.totalActiveUsers).toBe(70);
  });

  it("treats keys with differently-ordered properties as the same slot", async () => {
    // Stable stringification sorts keys recursively. `{workspaceId, filters}`
    // and `{filters, workspaceId}` describe the same query and must share a
    // cache slot.
    const store = initStore();
    const p1 = { workspaceId: 7, filters: { active: true } };
    const p2 = { filters: { active: true }, workspaceId: 7 } as DashboardParams;

    const handle = store.findQuery("dashboard", p1);
    await flushCoalescer();
    await handle.promise;

    // Second call with reordered keys should read from memory — no new request.
    const before = requests().filter((r) => r.url.pathname === "/dashboards").length;
    const handle2 = store.findQuery("dashboard", p2);
    expect(handle2.status).toBe("SUCCESS");
    expect(handle2.data).toBe(handle.data);
    expect(requests().filter((r) => r.url.pathname === "/dashboards")).toHaveLength(before);
  });
});

// =============================================================================
// findQuery — error propagation
// =============================================================================

describe("DocumentStore.findQuery errors", () => {
  it("transitions the handle to ERROR when the server rejects", async () => {
    server.use(
      http.get(`${API_BASE}/dashboards`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const handle = store.findQuery("dashboard", params);
    expect(handle.status).toBe("PENDING");

    await flushCoalescer();

    expect(handle.status).toBe("ERROR");
    expect(handle.error).toBeInstanceOf(Error);
    expect(handle.data).toBeUndefined();
  });

  it("clearMemory removes settled query errors so the next fetch starts cleanly", async () => {
    server.use(
      http.get(`${API_BASE}/dashboards`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const handle = store.findQuery("dashboard", params);

    await flushCoalescer();

    const rejectedPromise = handle.promise;
    expect(handle.status).toBe("ERROR");
    expect(handle.error).toBeInstanceOf(Error);

    store.clearMemory();
    expect(handle.status).toBe("IDLE");
    expect(handle.error).toBeUndefined();
    expect(handle.promise).toBeUndefined();

    server.resetHandlers();

    const retried = store.findQuery("dashboard", params);
    expect(retried).toBe(handle);
    expect(handle.promise).toBeInstanceOf(Promise);
    expect(handle.promise).not.toBe(rejectedPromise);

    await flushCoalescer();
    await handle.promise;

    expect(handle.status).toBe("SUCCESS");
    expect(handle.data?.totalActiveUsers).toBe(70);
  });
});

// =============================================================================
// insertQueryResult / findQueryInMemory
// =============================================================================

describe("DocumentStore.insertQueryResult + findQueryInMemory", () => {
  it("inserts a query result under the stringified params slot", () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const result = makeDashboard({ totalActiveUsers: 99 });

    store.insertQueryResult("dashboard", params, result);

    expect(store.findQueryInMemory("dashboard", params)).toBe(result);
  });

  it("overwrites at the same slot (last-write-wins)", () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };

    store.insertQueryResult("dashboard", params, makeDashboard({ totalActiveUsers: 1 }));
    store.insertQueryResult("dashboard", params, makeDashboard({ totalActiveUsers: 2 }));

    expect(store.findQueryInMemory("dashboard", params)?.totalActiveUsers).toBe(2);
  });

  it("triggers reactive re-renders on insert", () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const reads: Array<number | undefined> = [];

    const stop = effect(() => {
      reads.push(store.findQueryInMemory("dashboard", params)?.totalActiveUsers);
    });

    store.insertQueryResult("dashboard", params, makeDashboard({ totalActiveUsers: 11 }));
    store.insertQueryResult("dashboard", params, makeDashboard({ totalActiveUsers: 22 }));

    expect(reads).toEqual([undefined, 11, 22]);
    stop();
  });

  it("treats deep-equal params as the same slot", () => {
    const store = initStore();
    const p1: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const p2: DashboardParams = { workspaceId: 7, filters: { active: true } };

    const result = makeDashboard({ totalActiveUsers: 42 });
    store.insertQueryResult("dashboard", p1, result);

    expect(store.findQueryInMemory("dashboard", p2)).toBe(result);
  });
});

// =============================================================================
// Finder pipeline — raw params to adapter, dedup by deep-equal, batching
// =============================================================================

describe("Finder pipeline with query params", () => {
  it("dedups concurrent findQuery calls with deep-equal params into one request", async () => {
    const store = initStore();
    const p1: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const p2: DashboardParams = { workspaceId: 7, filters: { active: true } };

    const h1 = store.findQuery("dashboard", p1);
    const h2 = store.findQuery("dashboard", p2);
    expect(h1).toBe(h2);

    await flushCoalescer();
    await h1.promise;

    const dashboardRequests = requests().filter((r) => r.url.pathname === "/dashboards");
    expect(dashboardRequests).toHaveLength(1);
  });

  it("does not dedup different params", async () => {
    const store = initStore();
    const h7 = store.findQuery("dashboard", { workspaceId: 7, filters: { active: true } });
    const h8 = store.findQuery("dashboard", { workspaceId: 8, filters: { active: true } });

    await flushCoalescer();
    await Promise.all([h7.promise, h8.promise]);

    const dashboardRequests = requests().filter((r) => r.url.pathname === "/dashboards");
    expect(dashboardRequests).toHaveLength(2);
    expect(h7.data?.totalActiveUsers).toBe(70);
    expect(h8.data?.totalActiveUsers).toBe(80);
  });

  it("hands the raw params objects (not stringified) to the adapter", async () => {
    // Spy via a custom store whose query adapter captures its input.
    // Ensures the library does NOT stringify before handing off — the
    // adapter sees the original object shape.
    const received: Array<ReadonlyArray<DashboardParams>> = [];
    const captureStore = createDocumentStore<TypeToModel, TypeToQuery>({
      models: {
        user: { adapter: { find: async () => [] } },
        post: { adapter: { find: async () => [] } },
        "card-stack": { adapter: { find: async () => ({ data: [], included: [] }) } },
      },
      queries: {
        dashboard: {
          adapter: {
            async find(paramsList) {
              received.push(paramsList);
              return paramsList.map((p) => makeDashboard({ totalActiveUsers: p.workspaceId * 10 }));
            },
          },
        },
      },
    });

    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const handle = captureStore.findQuery("dashboard", params);

    await flushCoalescer();
    await handle.promise;

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    expect(received[0][0]).toEqual(params);
    expect(typeof received[0][0]).toBe("object");
  });
});

// =============================================================================
// Shared memory — query processors can normalize into the documents cache
// =============================================================================

describe("Queries share memory with documents", () => {
  it("a query processor can insertDocument to populate the documents cache", async () => {
    // A custom query processor: fetches a dashboard AND inserts a nested
    // user document into the documents cache, so future useDocument("user", id)
    // reads resolve from memory without an additional fetch.
    type Types = { user: { id: string; name: string } };
    type Queries = {
      dashWithUser: { params: { id: number }; result: { userId: string } };
    };

    const store = createDocumentStore<Types, Queries>({
      models: {
        user: { adapter: { find: async () => [] } },
      },
      queries: {
        dashWithUser: {
          adapter: {
            async find(paramsList) {
              return paramsList.map((p) => ({
                userId: `user-${p.id}`,
                embeddedUser: { id: `user-${p.id}`, name: `User ${p.id}` },
              }));
            },
          },
          processor: (raw, store, type, paramsList) => {
            const results = raw as Array<{
              userId: string;
              embeddedUser: { id: string; name: string };
            }>;
            for (let i = 0; i < paramsList.length; i++) {
              // Normalize: insert the embedded user into the documents cache
              store.insertDocument("user", results[i].embeddedUser);
              // Store the query result — just the id, not the data
              store.insertQueryResult(type, paramsList[i], { userId: results[i].userId });
            }
          },
        },
      },
    });

    const handle = store.findQuery("dashWithUser", { id: 42 });
    await flushCoalescer();
    await handle.promise;

    // Query result stored under the query's slot
    expect(handle.data).toEqual({ userId: "user-42" });

    // Nested user normalized into the documents cache — useDocument would find it
    expect(store.findInMemory("user", "user-42")).toEqual({
      id: "user-42",
      name: "User 42",
    });
  });

  it("documents and queries live in independent slots on the same store", () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };

    store.insertDocument("user", makeUser("1"));
    store.insertQueryResult("dashboard", params, makeDashboard({ totalActiveUsers: 42 }));

    // Both live in the same store, same underlying memory, but namespaced
    // so a query key and a document id can't collide.
    expect(store.findInMemory("user", "1")?.id).toBe("1");
    expect(store.findQueryInMemory("dashboard", params)?.totalActiveUsers).toBe(42);
  });

  it("clearMemory drops both documents and query results", async () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };

    store.insertDocument("user", makeUser("1"));
    store.insertQueryResult("dashboard", params, makeDashboard());

    store.clearMemory();

    expect(store.findInMemory("user", "1")).toBeUndefined();
    expect(store.findQueryInMemory("dashboard", params)).toBeUndefined();
  });

  it("insertQueryResult recovers an ERROR query handle with a fresh promise", async () => {
    server.use(
      http.get(`${API_BASE}/dashboards`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const handle = store.findQuery("dashboard", params);
    await flushCoalescer();

    const rejectedPromise = handle.promise;
    expect(handle.status).toBe("ERROR");

    const result = makeDashboard({ totalActiveUsers: 101 });
    store.insertQueryResult("dashboard", params, result);

    expect(handle.status).toBe("SUCCESS");
    expect(handle.data).toBe(result);
    expect(handle.error).toBeUndefined();
    expect(handle.promise).not.toBe(rejectedPromise);
    await expect(handle.promise).resolves.toBe(result);
  });

  it("stores primitive query results without freezing", () => {
    type Types = { user: { id: string; name: string } };
    type Queries = { count: { params: { id: string }; result: number } };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: async () => [] } } },
      queries: {
        count: {
          adapter: {
            async find() {
              return [];
            },
          },
        },
      },
    });

    store.insertQueryResult("count", { id: "a" }, 42);

    expect(store.findQueryInMemory("count", { id: "a" })).toBe(42);
  });
});

// =============================================================================
// Finder internals — branches public store calls normally hide
// =============================================================================

describe("Finder queue internals", () => {
  it("dedupes duplicate document and query queue entries during a drain", async () => {
    const documentFind = vi.fn(async () => []);
    const queryFind = vi.fn(async () => []);
    const state: InternalState = { documents: new Map(), queries: new Map() };
    const store = { insertDocument: vi.fn(), insertQueryResult: vi.fn() };

    const finder = new Finder({
      batchWindowMs: 1_000_000,
      models: {
        user: { adapter: { find: documentFind } },
      },
      queries: {
        dashboard: { adapter: { find: queryFind } },
      },
    } as any);

    finder.attach(state, store as any);
    finder.queueDocument("user" as any, "1");
    finder.queueDocument("user" as any, "1");
    finder.queueQuery("dashboard" as any, "same-key", { workspaceId: 1 } as never);
    finder.queueQuery("dashboard" as any, "same-key", { workspaceId: 1 } as never);

    await (finder as any).drain();

    expect(documentFind).toHaveBeenCalledWith(["1"]);
    expect(queryFind).toHaveBeenCalledWith([{ workspaceId: 1 }]);
  });

  it("returns early for empty drains and missing query configs", async () => {
    const finder = new Finder({
      batchWindowMs: 1_000_000,
      models: {
        user: { adapter: { find: async () => [] } },
      },
    } as any);

    finder.attach({ documents: new Map(), queries: new Map() }, {} as any);
    await expect((finder as any).drain()).resolves.toBeUndefined();

    finder.queueQuery("unknown" as any, "params-key", { q: "missing" } as never);
    await expect((finder as any).drain()).resolves.toBeUndefined();
  });

  it("ignores rejected chunks when no waiting handles remain", () => {
    const finder = new Finder({
      models: {
        user: { adapter: { find: async () => [] } },
      },
      queries: {
        dashboard: { adapter: { find: async () => [] } },
      },
    } as any);

    finder.attach({ documents: new Map(), queries: new Map() }, {} as any);

    expect(() =>
      (finder as any).rejectDocumentChunk("user", ["missing"], "document failure"),
    ).not.toThrow();
    expect(() =>
      (finder as any).rejectQueryChunk("dashboard", [{ paramsKey: "missing", params: {} }], {
        message: "query failure",
      }),
    ).not.toThrow();
  });
});

// =============================================================================
// Query finder error paths — processor omits result or throws
// =============================================================================

describe("Query finder errors", () => {
  it("sets query handle to ERROR when processor does not insert the result", async () => {
    type Types = { user: { id: string; name: string } };
    type Queries = { search: { params: { q: string }; result: { ids: string[] } } };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: async () => [] } } },
      queries: {
        search: {
          adapter: {
            async find() {
              return [];
            },
          },
          // Processor intentionally does NOT call insertQueryResult
          processor: () => {},
        },
      },
    });

    const handle = store.findQuery("search", { q: "hello" });
    await flushCoalescer();
    await handle.promise!.catch(() => {});

    expect(handle.status).toBe("ERROR");
    expect(handle.error?.message).toMatch(/query result not found after fetch/i);
  });

  it("sets query handle to ERROR when query processor throws", async () => {
    type Types = { user: { id: string; name: string } };
    type Queries = { boom: { params: { n: number }; result: { value: number } } };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: async () => [] } } },
      queries: {
        boom: {
          adapter: {
            async find() {
              return [];
            },
          },
          processor: () => {
            throw new Error("processor-exploded");
          },
        },
      },
    });

    const handle = store.findQuery("boom", { n: 1 });
    await flushCoalescer();
    await handle.promise!.catch(() => {});

    expect(handle.status).toBe("ERROR");
    expect(handle.error?.message).toBe("processor-exploded");
  });
});

// =============================================================================
// insertQueryResult — IDLE and ERROR status transitions
// =============================================================================

describe("insertQueryResult — IDLE and ERROR transitions", () => {
  it("transitions a handle from IDLE → SUCCESS via insertQueryResult", async () => {
    // Strategy: insertQueryResult creates a SUCCESS handle on first call.
    // clearMemory() resets it to IDLE (isFetching was false, so resetHandle
    // sets status=IDLE). A second insertQueryResult call finds the IDLE handle
    // and takes the `else if (status === "IDLE")` branch (lines 566-572).
    const store = createDocumentStore<TypeToModel, TypeToQuery>({
      models: {
        user: { adapter: { find: async () => [] } },
        post: { adapter: { find: async () => [] } },
        "card-stack": { adapter: { find: async () => ({ data: [], included: [] }) } },
      },
      queries: {
        dashboard: { adapter: { find: () => new Promise(() => {}) } },
      },
    });

    const params: DashboardParams = { workspaceId: 99, filters: { active: false } };
    const d1 = makeDashboard({ totalActiveUsers: 990 });
    const d2 = makeDashboard({ totalActiveUsers: 991 });

    // First call: no existing slot → creates a new SUCCESS handle (not the IDLE branch)
    store.insertQueryResult("dashboard", params, d1);
    // clearMemory resets the (non-fetching) SUCCESS handle to IDLE
    store.clearMemory();
    // Second call: existing IDLE handle → exercises the IDLE → SUCCESS branch
    store.insertQueryResult("dashboard", params, d2);

    const inMemory = store.findQueryInMemory("dashboard", params);
    expect(inMemory?.totalActiveUsers).toBe(991);
  });

  it("transitions an ERROR query handle to SUCCESS via insertQueryResult", async () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 77, filters: { active: true } };

    // Simulate a failed fetch so the handle enters ERROR state.
    server.use(http.get(`${API_BASE}/dashboards`, () => HttpResponse.json({}, { status: 500 })));

    const handle = store.findQuery("dashboard", params);
    await flushCoalescer();
    await handle.promise?.catch(() => {});
    expect(handle.status).toBe("ERROR");

    // Reset MSW to avoid interfering with other tests
    server.resetHandlers();

    // Now insert a result directly into the ERROR handle (lines 566-572)
    const dashboard = makeDashboard({ totalActiveUsers: 770 });
    store.insertQueryResult("dashboard", params, dashboard);

    expect(handle.status).toBe("SUCCESS");
    expect(handle.data?.totalActiveUsers).toBe(770);
    expect(handle.isPending).toBe(false);
  });
});
