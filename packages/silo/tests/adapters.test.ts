import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { clearRequests, flushCoalescer, initStore, requests, server } from "./example-app";
import { setupFakeTimers } from "./setup/timers";

// =============================================================================
// Adapter tests.
//
// These verify the example adapters' network shape — bulk vs fan-out —
// using MSW request interception. Complement to finder.test.ts, which
// verifies Finder's own contract (batching/dedup/chunking) with real but
// non-networked adapters.
//
// The adapters live in example-app.ts; they're realistic consumer code. The
// library doesn't provide or require any particular adapter style. These
// tests prove both styles behave as documented and prove the store pipeline
// doesn't care which is used.
// =============================================================================

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

setupFakeTimers();

let store: ReturnType<typeof initStore>;

beforeEach(() => {
  store = initStore();
});

afterEach(() => {
  server.resetHandlers();
  clearRequests();
});

// =============================================================================
// Bulk adapter (user) — one network request per adapter.find call
// =============================================================================

describe("bulk adapter (user)", () => {
  it("sends one GET /users?id=...&id=... request for N finds in one batch", async () => {
    store.find("user", "1");
    store.find("user", "2");
    store.find("user", "3");

    await flushCoalescer();

    expect(requests()).toHaveLength(1);
    expect(requests()[0].url.pathname).toBe("/users");
    expect(requests()[0].url.searchParams.getAll("id").sort()).toEqual(["1", "2", "3"]);
  });

  it("dedup at the finder layer means 3 concurrent finds for the same id → 1 request with 1 id", async () => {
    store.find("user", "1");
    store.find("user", "1");
    store.find("user", "1");

    await flushCoalescer();

    expect(requests()).toHaveLength(1);
    expect(requests()[0].url.searchParams.getAll("id")).toEqual(["1"]);
  });
});

// =============================================================================
// Fan-out adapter (post) — N network requests for N ids
// =============================================================================

describe("fan-out adapter (post)", () => {
  it("sends N separate GET /posts/:id requests for N finds in one batch", async () => {
    store.find("post", "1");
    store.find("post", "2");
    store.find("post", "3");

    await flushCoalescer();

    expect(requests()).toHaveLength(3);
    const pathnames = requests()
      .map((r) => r.url.pathname)
      .sort();
    expect(pathnames).toEqual(["/posts/1", "/posts/2", "/posts/3"]);
  });

  it("dedup still applies at the finder layer — 3 concurrent finds for same id → 1 request", async () => {
    store.find("post", "1");
    store.find("post", "1");
    store.find("post", "1");

    await flushCoalescer();

    expect(requests()).toHaveLength(1);
    expect(requests()[0].url.pathname).toBe("/posts/1");
  });
});

// =============================================================================
// Mixed — each adapter keeps its own style; no coupling
// =============================================================================

describe("mixed adapters in one store", () => {
  it("bulk user + fan-out post each follow their own shape in the same tick", async () => {
    store.find("user", "1");
    store.find("user", "2");
    store.find("post", "1");
    store.find("post", "2");

    await flushCoalescer();

    // 1 bulk request for users + 2 fan-out requests for posts.
    expect(requests()).toHaveLength(3);

    const userReqs = requests().filter((r) => r.url.pathname === "/users");
    const postReqs = requests().filter((r) => r.url.pathname.startsWith("/posts/"));
    expect(userReqs).toHaveLength(1);
    expect(postReqs).toHaveLength(2);
  });
});

// =============================================================================
// Bulk JSON-API adapter (card-stack) — bulk style, envelope response
// =============================================================================

describe("bulk JSON-API adapter (card-stack)", () => {
  it("sends one GET /card-stacks?id=...&id=... request and unwraps the envelope", async () => {
    const h1 = store.find("card-stack", "1");
    const h2 = store.find("card-stack", "2");

    await flushCoalescer();
    await Promise.all([h1.promise, h2.promise]);

    // Bulk shape — one network request carries every id.
    expect(requests()).toHaveLength(1);
    expect(requests()[0].url.pathname).toBe("/card-stacks");
    expect(requests()[0].url.searchParams.getAll("id").sort()).toEqual(["1", "2"]);

    // The processor (jsonApiProcessor) unwrapped `{ data: [...] }` and the
    // store routed each card-stack into its own slot.
    expect(h1.data?.id).toBe("1");
    expect(h1.data?.attributes.title).toBe("Card Stack 1");
    expect(h2.data?.id).toBe("2");
    expect(h2.data?.attributes.title).toBe("Card Stack 2");
  });
});

// =============================================================================
// Fan-out query adapter (dashboard) — one GET per params object
// =============================================================================

describe("fan-out query adapter (dashboard)", () => {
  it("sends N separate GET /dashboards?... requests for N distinct param objects", async () => {
    const h1 = store.findQuery("dashboard", { workspaceId: 1, filters: { active: true } });
    const h2 = store.findQuery("dashboard", { workspaceId: 2, filters: { active: false } });

    await flushCoalescer();
    await Promise.all([h1.promise, h2.promise]);

    const dashboardReqs = requests().filter((r) => r.url.pathname === "/dashboards");
    expect(dashboardReqs).toHaveLength(2);

    // Each request carries the single params object it was issued for.
    const wsByActive = dashboardReqs.map((r) => ({
      ws: r.url.searchParams.get("ws"),
      active: r.url.searchParams.get("active"),
    }));
    expect(wsByActive).toEqual(
      expect.arrayContaining([
        { ws: "1", active: "true" },
        { ws: "2", active: "false" },
      ]),
    );

    expect(h1.data?.totalActiveUsers).toBe(10);
    expect(h2.data?.totalActiveUsers).toBe(20);
  });

  it("dedups deep-equal params at the finder layer — 3 concurrent identical findQuery → 1 request", async () => {
    const params = { workspaceId: 5, filters: { active: true } };
    store.findQuery("dashboard", params);
    store.findQuery("dashboard", { workspaceId: 5, filters: { active: true } });
    store.findQuery("dashboard", { filters: { active: true }, workspaceId: 5 });

    await flushCoalescer();

    const dashboardReqs = requests().filter((r) => r.url.pathname === "/dashboards");
    expect(dashboardReqs).toHaveLength(1);
  });
});
