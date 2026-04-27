import { effect } from "@supergrain/kernel";
import { http, HttpResponse } from "msw";
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";

import {
  API_BASE,
  clearRequests,
  flushCoalescer,
  initStore,
  makeUser,
  requests,
  server,
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

let store: ReturnType<typeof initStore>;

beforeEach(() => {
  vi.useFakeTimers();
  store = initStore();
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
    expect(typeof store.find).toBe("function");
    expect(typeof store.findInMemory).toBe("function");
    expect(typeof store.insertDocument).toBe("function");
    expect(typeof store.clearMemory).toBe("function");
  });
});

// =============================================================================
// Memory operations — insert / findInMemory / clearMemory round-trip through
// the reactive tree the store owns.
// =============================================================================

describe("Store memory operations", () => {
  it("insertDocument makes the document retrievable via findInMemory", () => {
    const user = makeUser("1");
    store.insertDocument("user", user);

    expect(store.findInMemory("user", "1")).toBe(user);
  });

  it("findInMemory returns undefined for a missing document", () => {
    expect(store.findInMemory("user", "999")).toBeUndefined();
  });

  it("clearMemory drops all documents", () => {
    store.insertDocument("user", makeUser("1"));
    store.clearMemory();

    expect(store.findInMemory("user", "1")).toBeUndefined();
  });
});

// =============================================================================
// Store.find — state transitions on the returned handle
// =============================================================================

describe("Store.find — idle (no fetch)", () => {
  it("returns an idle handle when id is null", () => {
    const handle = store.find("user", null);

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
    expect(store.find("user", undefined).status).toBe("IDLE");
  });
});

describe("Store.find — already in memory (fast path)", () => {
  it("returns a SUCCESS handle and never touches the network", async () => {
    const user = makeUser("1");
    store.insertDocument("user", user);

    const handle = store.find("user", "1");

    expect(handle.status).toBe("SUCCESS");
    expect(handle.data).toBe(user);
    expect(handle.hasData).toBe(true);
    expect(handle.isPending).toBe(false);
    expect(handle.isFetching).toBe(false);

    await flushCoalescer();
    expect(requests()).toEqual([]); // no fetch ever happened
  });
});

describe("Store.find — not in memory (delegates to internal batching)", () => {
  it("returns a PENDING handle while the fetch is in flight", () => {
    const handle = store.find("user", "1");

    expect(handle.status).toBe("PENDING");
    expect(handle.isPending).toBe(true);
    expect(handle.isFetching).toBe(true);
    expect(handle.data).toBeUndefined();
  });

  it("transitions to SUCCESS once the network resolves", async () => {
    const handle = store.find("user", "1");
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
    const handle = store.find("user", "1");
    expect(handle.promise).toBeInstanceOf(Promise);

    await flushCoalescer();

    const resolved = await handle.promise;
    expect(resolved?.id).toBe("1");
  });

  it("works with a fan-out adapter too (post: N parallel GET /posts/:id)", async () => {
    // The library is adapter-agnostic. post's adapter fires one GET per id
    // under the hood (via Promise.all). From the store's perspective the
    // handle behavior is identical to a bulk-fetching adapter.
    const handle = store.find("post", "42");
    expect(handle.status).toBe("PENDING");

    await flushCoalescer();

    expect(handle.status).toBe("SUCCESS");
    expect(handle.data?.id).toBe("42");
    expect(handle.data?.attributes.title).toBe("Post42");
  });
});

describe("Store.find — server errors surface as ERROR", () => {
  it("transitions to ERROR when the server returns 500", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );

    const handle = store.find("user", "1");
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
    const a = store.find("user", "1");
    const b = store.find("user", "1");

    expect(a).toBe(b);
  });

  it("returns different handles for different ids", () => {
    expect(store.find("user", "1")).not.toBe(store.find("user", "2"));
  });

  it("returns different handles across types even with the same id", () => {
    expect(store.find("user", "1")).not.toBe(store.find("post", "1"));
  });
});

// =============================================================================
// Store.find — reactivity: a later insertDocument updates a live handle.
// =============================================================================

describe("Store.find — reactive updates", () => {
  it("flips the handle to SUCCESS when an external insertDocument lands", () => {
    const handle = store.find("user", "1");
    expect(handle.status).toBe("PENDING");

    store.insertDocument("user", makeUser("1", { firstName: "Pushed" }));

    expect(handle.status).toBe("SUCCESS");
    expect(handle.data?.attributes.firstName).toBe("Pushed");
    expect(handle.hasData).toBe(true);
  });

  it("re-exposes fresher data when insertDocument overwrites a cached doc", async () => {
    const handle = store.find("user", "1");
    await flushCoalescer();
    expect(handle.data?.attributes.firstName).toBe("User1");

    store.insertDocument("user", makeUser("1", { firstName: "Renamed" }));
    expect(handle.data?.attributes.firstName).toBe("Renamed");
  });

  it("lets a later fetch overwrite a mid-flight local insert (last-write-wins)", async () => {
    // Spec: if insertDocument lands during an in-flight fetch for the same
    // key, the local insert wins first, then the fetch resolves and
    // overwrites. No reconciliation — the fetched value wins.
    const handle = store.find("user", "1");
    store.insertDocument("user", makeUser("1", { firstName: "Local" }));
    expect(handle.data?.attributes.firstName).toBe("Local");

    await flushCoalescer();

    // MSW handler returns firstName: "User1"; that wins over the local insert.
    expect(handle.data?.attributes.firstName).toBe("User1");
  });
});

// =============================================================================
// Store.find — SUCCESS-after-ERROR creates a NEW promise object.
// =============================================================================

describe("Store.find — error recovery creates a new promise", () => {
  it("replaces the rejected promise with a fresh one once data arrives", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );

    const handle = store.find("user", "1");
    await flushCoalescer();
    const rejectedPromise = handle.promise;
    expect(handle.status).toBe("ERROR");

    // A fresh insert (e.g. from a socket push) flips the handle back to SUCCESS.
    store.insertDocument("user", makeUser("1", { firstName: "Recovered" }));

    expect(handle.status).toBe("SUCCESS");
    expect(handle.promise).not.toBe(rejectedPromise);
    expect(handle.data?.attributes.firstName).toBe("Recovered");
  });
});

// =============================================================================
// Store.clearMemory — effects on already-returned handles.
// =============================================================================

describe("Store.clearMemory — handle transitions", () => {
  it("flips SUCCESS handles to IDLE when there is no in-flight fetch", () => {
    store.insertDocument("user", makeUser("1"));
    const handle = store.find("user", "1");
    expect(handle.status).toBe("SUCCESS");

    store.clearMemory();

    expect(handle.status).toBe("IDLE");
    expect(handle.data).toBeUndefined();
    expect(handle.hasData).toBe(false);
    expect(handle.promise).toBeUndefined();
  });

  it("leaves PENDING handles PENDING — the in-flight fetch is not cancelled", async () => {
    const handle = store.find("user", "1");
    expect(handle.status).toBe("PENDING");

    store.clearMemory();
    expect(handle.status).toBe("PENDING");

    await flushCoalescer();

    // Fetch completed; processor re-populated the doc on the (now cleared) store.
    expect(handle.status).toBe("SUCCESS");
    expect(handle.data?.id).toBe("1");
  });
});

// =============================================================================
// Reactive isolation — a subscriber to one (type, id) does not re-run when an
// unrelated (type, id) is first accessed. Locks in the over-subscription fix.
// =============================================================================

describe("Store.find — subscription isolation", () => {
  it("a subscriber to (user, 1) does not re-run when (post, 99) is first accessed", () => {
    let runs = 0;
    const dispose = effect(() => {
      // Mirrors what `tracked()` does: read the same handle properties a
      // consumer would. The proxy reads register the subscriptions.
      const handle = store.find("user", "1");
      void handle.status;
      void handle.data;
      runs++;
    });

    try {
      const initial = runs;
      // First-time access on a different type. Pre-fix this would bump
      // state.documents's $OWN_KEYS and force the effect to re-run.
      store.find("post", "99");
      expect(runs).toBe(initial);

      // First-time access on a different id under the SAME type. Pre-fix
      // this would bump the user bucket's $OWN_KEYS and force a re-run.
      store.find("user", "2");
      expect(runs).toBe(initial);
    } finally {
      dispose();
    }
  });

  it("a subscriber to (user, 1) does not re-run when (post, 99) is first inserted", () => {
    let runs = 0;
    const dispose = effect(() => {
      const handle = store.find("user", "1");
      void handle.status;
      void handle.data;
      runs++;
    });

    try {
      const initial = runs;
      store.insertDocument("post", {
        id: "99",
        attributes: { title: "x", body: "", authorId: "" },
      });
      expect(runs).toBe(initial);
    } finally {
      dispose();
    }
  });
});

// =============================================================================
// Prototype-property safety — ids that collide with Object.prototype methods
// must not pollute the prototype chain or confuse the cache.
// =============================================================================

describe("Store — prototype-property safety for cache keys", () => {
  it("insertDocument with a prototype-name id stores the doc without polluting Object.prototype", () => {
    // Sentinel: a fresh object that inherits everything from Object.prototype.
    // If the cache mutates an inherited method (e.g. Object.prototype.toString),
    // the pollution becomes visible on this sentinel via prototype lookup.
    const sentinel: Record<string, unknown> = {};
    const protoNames = ["toString", "hasOwnProperty", "valueOf", "isPrototypeOf"];

    for (const name of protoNames) {
      // Pristine: the inherited function exists, but has no `.data` / `.hasData`
      // / `.status` properties on it.
      const inherited = (sentinel as any)[name];
      expect(inherited?.data).toBeUndefined();
      expect(inherited?.hasData).toBeUndefined();
      expect(inherited?.status).toBeUndefined();

      store.insertDocument("user", makeUser(name));

      // Still pristine after insert.
      expect((sentinel as any)[name]?.data).toBeUndefined();
      expect((sentinel as any)[name]?.hasData).toBeUndefined();
      expect((sentinel as any)[name]?.status).toBeUndefined();

      // And the doc is correctly retrievable — confirms the own-property write
      // shadowed the prototype lookup.
      expect(store.findInMemory("user", name)?.id).toBe(name);
    }
  });

  it("find() driving a fetch with a prototype-name id resolves correctly without polluting", async () => {
    const sentinel: Record<string, unknown> = {};
    const handle = store.find("user", "toString");
    expect(handle.status).toBe("PENDING");

    await flushCoalescer();

    expect(handle.status).toBe("SUCCESS");
    expect(handle.data?.id).toBe("toString");

    // Finder writes through the same protected path. No prototype mutation.
    expect((sentinel as any).toString?.data).toBeUndefined();
    expect((sentinel as any).toString?.hasData).toBeUndefined();
    expect((sentinel as any).toString?.status).toBeUndefined();
  });

  it("accepts __proto__, constructor, and prototype as ids without polluting Object.prototype", () => {
    // With null-prototype bucket records, these become ordinary own-property
    // keys — no inherited setter is invoked, no global pollution.
    const sentinelProto = Object.getPrototypeOf({});

    for (const name of ["__proto__", "constructor", "prototype"]) {
      store.insertDocument("user", makeUser(name));
      expect(store.findInMemory("user", name)?.id).toBe(name);
    }

    // Object.prototype is unchanged.
    expect(Object.getPrototypeOf({})).toBe(sentinelProto);
    expect((Object.prototype as any).id).toBeUndefined();
  });
});
