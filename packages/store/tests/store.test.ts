import { http, HttpResponse } from "msw";
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";

import {
  API_BASE,
  clearRequests,
  createApp,
  flushCoalescer,
  makeUser,
  requests,
  server,
  type App,
} from "./example-app";

// =============================================================================
// MSW lifecycle — intercept network for the whole test file.
// =============================================================================

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

// =============================================================================
// Shared app across every test. Fresh instance per test so in-memory state
// doesn't leak, but the wiring is always the same and looks like real
// consumer code.
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
// Public API surface
// =============================================================================

describe("Store — public API", () => {
  it("exposes find, findInMemory, insertDocument, clearMemory", () => {
    expect(typeof app.store.find).toBe("function");
    expect(typeof app.store.findInMemory).toBe("function");
    expect(typeof app.store.insertDocument).toBe("function");
    expect(typeof app.store.clearMemory).toBe("function");
  });
});

// =============================================================================
// Memory delegation (MemoryEngine behavior is tested in memory.test.ts —
// these tests only confirm that Store wires through to it correctly).
// =============================================================================

describe("Store delegates memory operations to MemoryEngine", () => {
  it("insertDocument makes the document retrievable via findInMemory", () => {
    const user = makeUser("1");
    app.store.insertDocument(user);

    expect(app.store.findInMemory("user", "1")).toBe(user);
  });

  it("findInMemory returns undefined for a missing document", () => {
    expect(app.store.findInMemory("user", "999")).toBeUndefined();
  });

  it("clearMemory drops all documents", () => {
    app.store.insertDocument(makeUser("1"));
    app.store.clearMemory();

    expect(app.store.findInMemory("user", "1")).toBeUndefined();
  });
});

// =============================================================================
// Store.find — state transitions on the returned handle
// =============================================================================

describe("Store.find — idle (no fetch)", () => {
  it("returns an idle handle when id is null", () => {
    const handle = app.store.find("user", null);

    expect(handle.status).toBe("IDLE");
    expect(handle.data).toBeUndefined();
    expect(handle.error).toBeUndefined();
    expect(handle.isPending).toBe(false);
    expect(handle.isFetching).toBe(false);
    expect(handle.hasData).toBe(false);
    expect(handle.fetchedAt).toBeUndefined();
    expect(handle.promise).toBeUndefined();
  });

  it("returns an idle handle when id is undefined", () => {
    expect(app.store.find("user", undefined).status).toBe("IDLE");
  });
});

describe("Store.find — already in memory (fast path)", () => {
  it("returns a SUCCESS handle and never touches the network", async () => {
    const user = makeUser("1");
    app.store.insertDocument(user);

    const handle = app.store.find("user", "1");

    expect(handle.status).toBe("SUCCESS");
    expect(handle.data).toBe(user);
    expect(handle.hasData).toBe(true);
    expect(handle.isPending).toBe(false);
    expect(handle.isFetching).toBe(false);

    await flushCoalescer();
    expect(requests()).toEqual([]); // no fetch ever happened
  });
});

describe("Store.find — not in memory (delegates to Finder)", () => {
  it("returns a PENDING handle while the finder fetches", () => {
    const handle = app.store.find("user", "1");

    expect(handle.status).toBe("PENDING");
    expect(handle.isPending).toBe(true);
    expect(handle.isFetching).toBe(true);
    expect(handle.data).toBeUndefined();
  });

  it("transitions to SUCCESS once the network resolves", async () => {
    const handle = app.store.find("user", "1");
    expect(handle.status).toBe("PENDING");

    await flushCoalescer();

    expect(handle.status).toBe("SUCCESS");
    expect(handle.data?.id).toBe("1");
    expect(handle.data?.attributes.firstName).toBe("User1");
    expect(handle.hasData).toBe(true);
    expect(handle.isPending).toBe(false);
    expect(handle.isFetching).toBe(false);
    expect(handle.fetchedAt).toBeInstanceOf(Date);
  });

  it("exposes a stable Promise for React 19 use()", async () => {
    const handle = app.store.find("user", "1");
    expect(handle.promise).toBeInstanceOf(Promise);

    await flushCoalescer();

    const resolved = await handle.promise;
    expect(resolved?.id).toBe("1");
  });
});

describe("Store.find — server errors surface as ERROR", () => {
  it("transitions to ERROR when the server returns 500", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );

    const handle = app.store.find("user", "1");
    await flushCoalescer();

    expect(handle.status).toBe("ERROR");
    expect(handle.error).toBeInstanceOf(Error);
  });
});

// =============================================================================
// Handle identity — stable across calls
// =============================================================================

describe("Store.find — handle identity", () => {
  it("returns the same handle for repeat calls with the same (type, id)", () => {
    const a = app.store.find("user", "1");
    const b = app.store.find("user", "1");

    expect(a).toBe(b);
  });

  it("returns different handles for different ids", () => {
    expect(app.store.find("user", "1")).not.toBe(app.store.find("user", "2"));
  });

  it("returns different handles across types even with the same id", () => {
    expect(app.store.find("user", "1")).not.toBe(app.store.find("post", "1"));
  });
});
