import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Finder, Store } from "../src";
import {
  API_BASE,
  advance,
  clearRequests,
  createApp,
  flushCoalescer,
  requests,
  server,
  type App,
  type TypeToModel,
} from "./example-app";

// =============================================================================
// MSW lifecycle — intercept network for the whole file.
// =============================================================================

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

// =============================================================================
// Shared app — same wiring as store.test.ts. A fresh instance per test,
// but the shape (three models, real fetch-based adapters) is stable so
// every test reads the same way.
//
// The `requests()` log is the test's view of what network calls the library
// actually made. Assertions count requests and check pathnames; id-correctness
// is proven by the promise results (if three finds resolve to their own docs,
// the adapter must have carried the right ids).
// =============================================================================

let app: App;

beforeEach(() => {
  vi.useFakeTimers();
  app = createApp();
});

afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
  clearRequests();
});

// =============================================================================
// API surface
// =============================================================================

describe("new Finder — API surface", () => {
  it("exposes find and attachStore", () => {
    expect(typeof app.finder.find).toBe("function");
    expect(typeof app.finder.attachStore).toBe("function");
  });

  it("throws a clear error when find is called before a store is attached", async () => {
    // Construct a standalone finder — no Store has attached yet.
    const finder = new Finder<TypeToModel>({
      models: {
        user: { adapter: { find: () => Promise.resolve([]) } },
        post: { adapter: { find: () => Promise.resolve([]) } },
        "card-stack": { adapter: { find: () => Promise.resolve({ data: [] }) } },
      },
    });

    await expect(() => finder.find("user", "1")).rejects.toThrow(/store not attached/i);
  });
});

// =============================================================================
// Batching (default 15ms window)
// =============================================================================

describe("Finder batching", () => {
  it("collapses three near-simultaneous finds into a single network request", async () => {
    const p1 = app.finder.find("user", "1");
    const p2 = app.finder.find("user", "2");
    const p3 = app.finder.find("user", "3");
    await flushCoalescer();

    // All three resolve to their own docs — proves ids carried through correctly.
    expect((await p1).id).toBe("1");
    expect((await p2).id).toBe("2");
    expect((await p3).id).toBe("3");

    // One network round-trip served all three.
    expect(requests().length).toBe(1);
    expect(requests()[0].url.pathname).toBe("/users");
  });

  it("starts a fresh batch after the previous window drains", async () => {
    await app.finder.find("user", "1");
    await flushCoalescer();

    await app.finder.find("user", "2");
    await flushCoalescer();

    expect(requests().length).toBe(2);
  });

  it("respects a custom batchWindowMs", async () => {
    const slowApp = createApp({ batchWindowMs: 50 });

    slowApp.finder.find("user", "1");
    await advance(20);
    expect(requests().length).toBe(0); // window hasn't elapsed

    await advance(40);
    expect(requests().length).toBe(1);
  });

  it("fires separate requests per type in the same tick", async () => {
    const pUser = app.finder.find("user", "1");
    const pPost = app.finder.find("post", "1");
    await flushCoalescer();

    expect((await pUser).id).toBe("1");
    expect((await pPost).id).toBe("1");

    const paths = requests()
      .map((r) => r.url.pathname)
      .sort();
    expect(paths).toEqual(["/posts", "/users"]);
  });
});

// =============================================================================
// Dedup
// =============================================================================

describe("Finder dedup", () => {
  it("collapses concurrent requests for the same id into one network call", async () => {
    const p1 = app.finder.find("user", "1");
    const p2 = app.finder.find("user", "1");
    const p3 = app.finder.find("user", "1");
    await flushCoalescer();

    // All three promises resolve to the same doc.
    const [d1, d2, d3] = await Promise.all([p1, p2, p3]);
    expect(d1.id).toBe("1");
    expect(d2).toBe(d1);
    expect(d3).toBe(d1);

    // Server saw one request, not three.
    expect(requests().length).toBe(1);
  });

  it("does not refetch an id that is already in flight", async () => {
    app.finder.find("user", "1");
    await advance(10); // mid-window
    app.finder.find("user", "1");
    await flushCoalescer();

    expect(requests().length).toBe(1);
  });
});

// =============================================================================
// Chunking (default batchSize 60)
// =============================================================================

describe("Finder chunking", () => {
  it("chunks 150 ids at the default batchSize 60 into 3 requests", async () => {
    // Fire 150 concurrent finds; every one must resolve correctly.
    const promises: Array<Promise<unknown>> = [];
    for (let i = 0; i < 150; i++) {
      promises.push(app.finder.find("user", String(i)));
    }
    await flushCoalescer();
    await Promise.all(promises);

    // 150 ids at batchSize 60 → 3 chunks.
    expect(requests().length).toBe(3);
  });

  it("respects a custom batchSize", async () => {
    const smallBatchApp = createApp({ batchSize: 10 });

    const promises: Array<Promise<unknown>> = [];
    for (let i = 0; i < 25; i++) {
      promises.push(smallBatchApp.finder.find("user", String(i)));
    }
    await flushCoalescer();
    await Promise.all(promises);

    // 25 ids at batchSize 10 → 3 chunks (10 + 10 + 5).
    expect(requests().length).toBe(3);
  });
});

// =============================================================================
// Store insertion via processor
// =============================================================================

describe("Finder → store insertion", () => {
  it("runs the default processor (user: bare array response) and inserts", async () => {
    app.finder.find("user", "1");
    await flushCoalescer();

    expect(app.store.findInMemory("user", "1")?.attributes.firstName).toBe("User1");
  });

  it("runs a custom processor (card-stack: JSON-API envelope) and inserts", async () => {
    // card-stack is configured with processor: jsonApiProcessor in createApp.
    // Its server endpoint returns { data, included } — the processor unwraps it.
    app.finder.find("card-stack", "42");
    await flushCoalescer();

    expect(app.store.findInMemory("card-stack", "42")?.attributes.title).toBe("Card Stack 42");
  });

  it("resolves the find promise with the document matching the requested id", async () => {
    const promise = app.finder.find("user", "1");
    await flushCoalescer();

    const doc = await promise;
    expect(doc.id).toBe("1");
    expect(doc.attributes.firstName).toBe("User1");
  });

  it("rejects the find promise when the server returns no match for the requested id", async () => {
    // Override the handler: the server returns an empty list.
    server.use(http.get(`${API_BASE}/users`, () => HttpResponse.json([])));

    const p = app.finder.find("user", "1");
    await flushCoalescer();

    await expect(p).rejects.toThrow(/not found/i);
  });
});

// =============================================================================
// Errors
// =============================================================================

describe("Finder errors", () => {
  it("rejects the find promise when the network fails", async () => {
    server.use(http.get(`${API_BASE}/users`, () => HttpResponse.error()));

    const promise = app.finder.find("user", "1");
    await flushCoalescer();

    await expect(promise).rejects.toThrow();
  });

  it("rejects the find promise when the server returns 5xx", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () =>
        HttpResponse.json({ message: "server down" }, { status: 503 }),
      ),
    );

    const promise = app.finder.find("user", "1");
    await flushCoalescer();

    await expect(promise).rejects.toThrow(/503/);
  });

  it("rejects the find promise when a processor throws", async () => {
    // Construct a custom finder + store with one model using a throwing
    // processor. A real consumer configuring a broken processor would get
    // the same behavior via their own model config.
    const processor = () => {
      throw new Error("processor exploded");
    };
    const finder = new Finder<TypeToModel>({
      models: {
        user: {
          adapter: { find: () => Promise.resolve([{ id: "1", type: "user", attributes: {} }]) },
          processor,
        },
        post: { adapter: { find: () => Promise.resolve([]) } },
        "card-stack": { adapter: { find: () => Promise.resolve({ data: [] }) } },
      },
    });
    new Store<TypeToModel>({ finder });

    const p = finder.find("user", "1");
    await flushCoalescer();

    await expect(p).rejects.toThrow(/processor exploded/);
  });
});
