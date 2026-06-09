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
import { Effect } from "effect";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
import { effectFind } from "./setup/effect-find";
import { setupFakeTimers } from "./setup/timers";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  clearRequests();
});
afterAll(() => server.close());

setupFakeTimers();

// =============================================================================
// findQuery — reactive handle, stable identity, network on miss
// =============================================================================

describe("DocumentStore.findQuery", () => {
  it("returns an idle handle when params is null", () => {
    const store = initStore();
    const handle = store.findQuery("dashboard", null);

    expect(handle.value).toBeUndefined();
    expect(handle.isFetching).toBe(false);
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("pending");
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

  it("returns the same handle regardless of param key order", () => {
    // The cache key is order-independent (stableStringify sorts keys). This is
    // the contract the React `useQuery` hook leans on: a stable handle identity
    // for deep-equal params, so the subscription doesn't churn on re-renders
    // that hand over a reordered params object.
    const store = initStore();
    const h1 = store.findQuery("dashboard", { workspaceId: 7, filters: { active: true } });
    const h2 = store.findQuery("dashboard", {
      filters: { active: true },
      workspaceId: 7,
    } as DashboardParams);

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
    expect(handle.value === undefined && handle.isFetching).toBe(true);

    await flushCoalescer();
    await handle.promise;

    // Per the dashboard MSW handler, totalActiveUsers encodes the workspaceId.
    expect(handle.value).not.toBeUndefined();
    expect(handle.value?.totalActiveUsers).toBe(70);
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
    expect(handle2.value).not.toBeUndefined();
    expect(handle2.value).toBe(handle.value);
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
    expect(handle.value === undefined && handle.isFetching).toBe(true);

    await flushCoalescer();

    expect(handle.value === undefined && handle.error !== undefined).toBe(true);
    expect(handle.error).toBeInstanceOf(Error);
  });

  it("throws synchronously for a query type with no config (instead of stranding the handle)", () => {
    const store = initStore();
    expect(() => store.findQuery("not-configured" as never, { workspaceId: 1 } as never)).toThrow(
      /no query "not-configured" is configured/,
    );
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
    expect(handle.value === undefined && handle.error !== undefined).toBe(true);
    expect(handle.error).toBeInstanceOf(Error);

    store.clearMemory();
    expect(handle.value).toBeUndefined();
    expect(handle.isFetching).toBe(false);
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("pending");
    expect(handle.promise).toBeUndefined();

    server.resetHandlers();

    const retried = store.findQuery("dashboard", params);
    expect(retried).toBe(handle);
    expect(handle.promise).toBeInstanceOf(Promise);
    expect(handle.promise).not.toBe(rejectedPromise);

    await flushCoalescer();
    await handle.promise;

    expect(handle.value).not.toBeUndefined();
    expect(handle.value?.totalActiveUsers).toBe(70);
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
    expect(h7.value?.totalActiveUsers).toBe(70);
    expect(h8.value?.totalActiveUsers).toBe(80);
  });

  it("hands the raw params objects (not stringified) to the adapter", async () => {
    // Spy via a custom store whose query adapter captures its input.
    // Ensures the library does NOT stringify before handing off — the
    // adapter sees the original object shape.
    const received: Array<ReadonlyArray<DashboardParams>> = [];
    const captureStore = createDocumentStore<TypeToModel, TypeToQuery>({
      models: {
        user: { adapter: { find: effectFind("user", async () => []) } },
        post: { adapter: { find: effectFind("post", async () => []) } },
        "card-stack": {
          adapter: { find: effectFind("card-stack", async () => ({ data: [], included: [] })) },
        },
      },
      queries: {
        dashboard: {
          adapter: {
            find: effectFind("dashboard", async (paramsList: ReadonlyArray<DashboardParams>) => {
              received.push(paramsList);
              return paramsList.map((p) => makeDashboard({ totalActiveUsers: p.workspaceId * 10 }));
            }),
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
        user: { adapter: { find: effectFind("user", async () => []) } },
      },
      queries: {
        dashWithUser: {
          adapter: {
            find: effectFind("dashWithUser", async (paramsList: Array<{ id: number }>) =>
              paramsList.map((p) => ({
                userId: `user-${p.id}`,
                embeddedUser: { id: `user-${p.id}`, name: `User ${p.id}` },
              })),
            ),
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
    expect(handle.value).toEqual({ userId: "user-42" });

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
    expect(handle.value === undefined && handle.error !== undefined).toBe(true);

    const result = makeDashboard({ totalActiveUsers: 101 });
    store.insertQueryResult("dashboard", params, result);

    expect(handle.value).not.toBeUndefined();
    expect(handle.value).toBe(result);
    // A fresh value supersedes any prior error: the error clears and status
    // flips to success.
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("success");
    // An insert after a first-load failure hands out a fresh resolved promise
    // (so a Suspense boundary can recover).
    expect(handle.promise).not.toBe(rejectedPromise);
    await expect(handle.promise).resolves.toBe(result);
  });

  it("stores primitive query results without freezing", () => {
    type Types = { user: { id: string; name: string } };
    type Queries = { count: { params: { id: string }; result: number } };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: effectFind("user", async () => []) } } },
      queries: {
        count: {
          adapter: {
            find: effectFind("count", async () => []),
          },
        },
      },
    });

    store.insertQueryResult("count", { id: "a" }, 42);

    expect(store.findQueryInMemory("count", { id: "a" })).toBe(42);
  });
});

describe("Query finder errors", () => {
  it("sets query handle to ERROR when processor does not insert the result", async () => {
    type Types = { user: { id: string; name: string } };
    type Queries = { search: { params: { q: string }; result: { ids: string[] } } };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: effectFind("user", async () => []) } } },
      queries: {
        search: {
          adapter: {
            find: effectFind("search", async () => []),
          },
          processor: () => {},
        },
      },
    });

    const handle = store.findQuery("search", { q: "hello" });
    await flushCoalescer();
    await handle.promise!.catch(() => {});

    expect(handle.value === undefined && handle.error !== undefined).toBe(true);
    // The result was never inserted, so the handle settles to a NotFoundError.
    expect(handle.error?.message).toMatch(/not found/i);
  });

  it("sets query handle to ERROR when query processor throws", async () => {
    type Types = { user: { id: string; name: string } };
    type Queries = { boom: { params: { n: number }; result: { value: number } } };

    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: effectFind("user", async () => []) } } },
      queries: {
        boom: {
          adapter: {
            find: effectFind("boom", async () => []),
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

    expect(handle.error).toBeDefined();
    // A processor throw settles to a ProcessorError whose cause is the throw.
    const cause = (handle.error as { cause?: unknown }).cause;
    expect((cause as Error).message).toBe("processor-exploded");
  });
});

describe("insertQueryResult transitions existing handles", () => {
  it("updates an idle query handle without fetching", async () => {
    const store = createDocumentStore<TypeToModel, TypeToQuery>({
      models: {
        user: { adapter: { find: effectFind("user", async () => []) } },
        post: { adapter: { find: effectFind("post", async () => []) } },
        "card-stack": {
          adapter: { find: effectFind("card-stack", async () => ({ data: [], included: [] })) },
        },
      },
      queries: {
        dashboard: { adapter: { find: () => Effect.never } },
      },
    });

    const params: DashboardParams = { workspaceId: 99, filters: { active: false } };
    const d1 = makeDashboard({ totalActiveUsers: 990 });
    const d2 = makeDashboard({ totalActiveUsers: 991 });

    store.insertQueryResult("dashboard", params, d1);
    store.clearMemory();
    store.insertQueryResult("dashboard", params, d2);

    const inMemory = store.findQueryInMemory("dashboard", params);
    expect(inMemory?.totalActiveUsers).toBe(991);
  });

  it("transitions an ERROR query handle to SUCCESS via insertQueryResult", async () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 77, filters: { active: true } };

    server.use(http.get(`${API_BASE}/dashboards`, () => HttpResponse.json({}, { status: 500 })));

    const handle = store.findQuery("dashboard", params);
    await flushCoalescer();
    await handle.promise?.catch(() => {});
    expect(handle.value === undefined && handle.error !== undefined).toBe(true);

    server.resetHandlers();

    const dashboard = makeDashboard({ totalActiveUsers: 770 });
    store.insertQueryResult("dashboard", params, dashboard);

    expect(handle.value).not.toBeUndefined();
    expect(handle.value?.totalActiveUsers).toBe(770);
    // A fresh value supersedes the prior error.
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("success");
  });
});

// =============================================================================
// Query handle reactivity — effects subscribed to handle fields fire on
// transitions. The handle returned from findQuery is the binding surface
// for UI code; verifying it's actually reactive (not just lazy-correct on
// re-read) is the contract that matters for render loops.
// =============================================================================

describe("Query handle is reactive", () => {
  it("an effect tracking handle.fetch fires on PENDING -> SUCCESS via fetch", async () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const handle = store.findQuery("dashboard", params);

    const stateHistory: Array<string> = [];
    effect(() => {
      stateHistory.push(
        `${handle.value === undefined ? "Absent" : "Present"}/${handle.isFetching}`,
      );
    });
    expect(stateHistory).toEqual(["Absent/true"]);

    await flushCoalescer();
    await handle.promise;
    expect(stateHistory.at(-1)).toBe("Present/false");
  });

  it("an effect tracking handle.value fires when an external insertQueryResult lands", () => {
    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const handle = store.findQuery("dashboard", params);

    const totals: Array<number | undefined> = [];
    effect(() => {
      totals.push(handle.value?.totalActiveUsers);
    });
    expect(totals).toEqual([undefined]);

    store.insertQueryResult("dashboard", params, makeDashboard({ totalActiveUsers: 99 }));
    expect(totals.at(-1)).toBe(99);
  });

  it("an effect tracking handle.error fires on PENDING -> ERROR", async () => {
    server.use(
      http.get(`${API_BASE}/dashboards`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

    const store = initStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const handle = store.findQuery("dashboard", params);

    const errorHistory: Array<string | undefined> = [];
    effect(() => {
      errorHistory.push(handle.error?.message);
    });
    expect(errorHistory).toEqual([undefined]);

    await flushCoalescer();
    await handle.promise?.catch(() => {});
    expect(errorHistory.at(-1)).toMatch(/silo|adapter/i);

    // A fresh value supersedes the error: the error clears, so the error
    // effect re-fires to undefined.
    store.insertQueryResult("dashboard", params, makeDashboard({ totalActiveUsers: 99 }));
    expect(handle.value).not.toBeUndefined();
    expect(handle.error).toBeUndefined();
    expect(errorHistory.at(-1)).toBeUndefined();
  });
});

// =============================================================================
// Query key stability — stableStringify
// =============================================================================
//
// The query slot key is a stable, total string built from the params. Two
// params that differ only by a `Date` must NOT collide (a bare `Date` has no
// own-enumerable keys, so naive JSON would serialize every date to `{}`), and
// the key must be independent of object declaration order.
// =============================================================================

describe("query key stability (stableStringify)", () => {
  type KeyModels = { doc: { id: string } };
  type KeyQueries = { events: { params: { at: Date; tag: string }; result: { n: number } } };

  function makeKeyStore(): ReturnType<typeof createDocumentStore<KeyModels, KeyQueries>> {
    return createDocumentStore<KeyModels, KeyQueries>({
      models: { doc: { adapter: { find: () => Effect.succeed([]) } } },
    });
  }

  it("does not collide params that differ only by Date", () => {
    const store = makeKeyStore();
    const d1 = new Date("2026-01-01T00:00:00Z");
    const d2 = new Date("2026-02-01T00:00:00Z");

    store.insertQueryResult("events", { at: d1, tag: "x" }, { n: 1 });
    store.insertQueryResult("events", { at: d2, tag: "x" }, { n: 2 });

    expect(store.findQueryInMemory("events", { at: d1, tag: "x" })).toEqual({ n: 1 });
    expect(store.findQueryInMemory("events", { at: d2, tag: "x" })).toEqual({ n: 2 });
  });

  it("is independent of object key declaration order", () => {
    const store = makeKeyStore();
    const at = new Date("2026-01-01T00:00:00Z");

    store.insertQueryResult("events", { at, tag: "x" }, { n: 7 });

    // Same params, keys declared in the opposite order → same slot.
    const reordered = { tag: "x", at } as { at: Date; tag: string };
    expect(store.findQueryInMemory("events", reordered)).toEqual({ n: 7 });
  });
});
