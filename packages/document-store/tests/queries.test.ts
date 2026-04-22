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

import { effect } from "@supergrain/core";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
});
