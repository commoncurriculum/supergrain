import { effect, unwrap } from "@supergrain/kernel";
import { http, HttpResponse } from "msw";
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";

import { jsonApiProcessor } from "../src/processors/json-api";
import { createDocumentStore, type DocumentAdapter, type StoreHooks } from "../src/store";
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
} from "./example-app";
import { effectFind } from "./setup/effect-find";
import { setupFakeTimers } from "./setup/timers";

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

    // The stored value is the exact object inserted (no copy), handed back
    // through a reactive proxy — unwrap to compare raw identity.
    expect(unwrap(store.findInMemory("user", "1"))).toBe(user);
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
// hooks.prepareInsert — the one normalization funnel every insert passes through
// =============================================================================

describe("Store — hooks.prepareInsert", () => {
  // Local models mirror the consumer scenario: JSON-API-ish docs that share a
  // literal `type` discriminant and carry an optional `meta` bag to normalize.
  interface CardStack {
    id: string;
    type: "card-stack";
    cards?: ReadonlyArray<unknown>;
    meta?: Record<string, unknown>;
  }
  interface Planbook {
    id: string;
    type: "planbook";
    meta?: Record<string, unknown>;
  }
  type Models = { "card-stack": CardStack; planbook: Planbook };

  // The adapter is never invoked here — `insertDocument` is a pure memory write,
  // no fetch is enqueued — so a stub that resolves nothing is enough.
  const stubAdapter: DocumentAdapter = { find: () => Promise.resolve([]) };

  function makeHookStore(hooks: StoreHooks<Models>) {
    return createDocumentStore<Models>({
      hooks,
      models: {
        "card-stack": { adapter: stubAdapter },
        planbook: { adapter: stubAdapter },
      },
    });
  }

  function makeStore(prepareInsert: StoreHooks<Models>["prepareInsert"]) {
    return makeHookStore({ prepareInsert });
  }

  it("runs on every insertDocument, receiving the type and its doc", () => {
    const calls: Array<[string, string]> = [];
    const store = makeStore((type, doc) => {
      calls.push([type, doc.id]);
      return doc;
    });

    store.insertDocument("card-stack", { id: "1", type: "card-stack" });
    store.insertDocument("planbook", { id: "p1", type: "planbook" });

    expect(calls).toEqual([
      ["card-stack", "1"],
      ["planbook", "p1"],
    ]);
  });

  it("normalizes in place — the mutated object is what lands in the cache", () => {
    const store = makeStore((_type, doc) => {
      doc.meta ??= {};
      return doc;
    });
    const cs: CardStack = { id: "1", type: "card-stack" };

    store.insertDocument("card-stack", cs);

    // Stored object IS the inserted one (no copy) and carries the defaulted bag.
    expect(unwrap(store.findInMemory("card-stack", "1"))).toBe(cs);
    expect(cs.meta).toEqual({});
  });

  it("stores the replacement when the hook returns a new (spread) doc", () => {
    const store = makeStore((_type, doc) => ({ ...doc, meta: { normalized: true } }));
    const input: CardStack = { id: "1", type: "card-stack" };

    store.insertDocument("card-stack", input);

    const stored = unwrap(store.findInMemory("card-stack", "1"));
    expect(stored).not.toBe(input); // a fresh object replaced the input
    expect(stored?.meta).toEqual({ normalized: true });
  });

  it("vetoes the insert when the hook returns null — nothing is written", () => {
    const store = makeStore((_type, doc) => (doc.id === "drop" ? null : doc));

    store.insertDocument("card-stack", { id: "drop", type: "card-stack" });
    store.insertDocument("card-stack", { id: "keep", type: "card-stack" });

    expect(store.findInMemory("card-stack", "drop")).toBeUndefined();
    expect(unwrap(store.findInMemory("card-stack", "keep"))?.id).toBe("keep");
  });

  it("treats undefined (no return) the same as null — both veto", () => {
    const store = makeStore((_type, doc) => {
      doc.meta = { touched: true };
      // no `return` → undefined → veto, identical to returning null
    });

    store.insertDocument("card-stack", { id: "1", type: "card-stack" });

    expect(store.findInMemory("card-stack", "1")).toBeUndefined();
  });

  it("a null veto leaves any existing cached document untouched", () => {
    const store = makeStore((_type, doc) =>
      doc.id === "1" && (doc.meta?.drop ?? false) ? null : doc,
    );

    const original: CardStack = { id: "1", type: "card-stack" };
    store.insertDocument("card-stack", original);
    // A later vetoed insert for the same id must not clear what's cached.
    store.insertDocument("card-stack", { id: "1", type: "card-stack", meta: { drop: true } });

    expect(unwrap(store.findInMemory("card-stack", "1"))).toBe(original);
  });

  it("narrows on the doc.type discriminant for per-type normalization", () => {
    const store = makeStore((_type, doc) => {
      if (doc.type === "card-stack") doc.meta = { kind: "stack" };
      else doc.meta = { kind: "book" };
      return doc;
    });

    store.insertDocument("card-stack", { id: "1", type: "card-stack" });
    store.insertDocument("planbook", { id: "p1", type: "planbook" });

    expect(unwrap(store.findInMemory("card-stack", "1"))?.meta).toEqual({ kind: "stack" });
    expect(unwrap(store.findInMemory("planbook", "p1"))?.meta).toEqual({ kind: "book" });
  });

  it("runs for processor-driven inserts, including JSON-API `included` sideloads", () => {
    const seen: Array<string> = [];
    const store = makeStore((type, doc) => {
      seen.push(`${type}:${doc.id}`);
      doc.meta ??= {};
      return doc;
    });

    // Drive the processor exactly as the finder does after a fetch: its
    // `store.insertDocument(...)` calls funnel through `prepareInsert` just like a
    // direct insert, for both the requested `data` doc and the `included`
    // sideload (a different type entirely).
    jsonApiProcessor(
      {
        data: [{ id: "cs1", type: "card-stack" }],
        included: [{ id: "pb1", type: "planbook" }],
      },
      { store, type: "card-stack", ids: ["cs1"] },
    );

    expect(seen).toEqual(["card-stack:cs1", "planbook:pb1"]);
    expect(unwrap(store.findInMemory("card-stack", "cs1"))?.meta).toEqual({});
    expect(unwrap(store.findInMemory("planbook", "pb1"))?.meta).toEqual({});
  });

  it("is optional — a store without hooks inserts unchanged", () => {
    const store = createDocumentStore<Models>({
      models: {
        "card-stack": { adapter: stubAdapter },
        planbook: { adapter: stubAdapter },
      },
    });
    const cs: CardStack = { id: "1", type: "card-stack" };

    store.insertDocument("card-stack", cs);

    expect(unwrap(store.findInMemory("card-stack", "1"))).toBe(cs);
  });

  // ─── afterInsert — the write half of the bracket ────────────────────────────

  it("afterInsert runs on every insert, after the value is committed", () => {
    const observed: Array<[string, string]> = [];
    const store = makeHookStore({
      afterInsert: (type, doc) => {
        // The cache is already settled when afterInsert fires.
        expect(unwrap(store.findInMemory(type, doc.id))).toBe(doc);
        observed.push([type, doc.id]);
      },
    });

    store.insertDocument("card-stack", { id: "1", type: "card-stack" });
    store.insertDocument("planbook", { id: "p1", type: "planbook" });

    expect(observed).toEqual([
      ["card-stack", "1"],
      ["planbook", "p1"],
    ]);
  });

  it("afterInsert receives the post-prepareInsert (stored) doc", () => {
    let received: CardStack | Planbook | undefined;
    const store = makeHookStore({
      prepareInsert: (_type, doc) => ({ ...doc, meta: { normalized: true } }),
      afterInsert: (_type, doc) => {
        received = doc;
      },
    });

    store.insertDocument("card-stack", { id: "1", type: "card-stack" });

    // afterInsert sees the exact post-prepareInsert object that was stored.
    expect(received).toBe(unwrap(store.findInMemory("card-stack", "1")));
    expect((received as CardStack).meta).toEqual({ normalized: true });
  });

  it("afterInsert does NOT run when prepareInsert vetoes with null", () => {
    const observed: Array<string> = [];
    const store = makeHookStore({
      prepareInsert: (_type, doc) => (doc.id === "drop" ? null : doc),
      afterInsert: (_type, doc) => observed.push(doc.id),
    });

    store.insertDocument("card-stack", { id: "drop", type: "card-stack" });
    store.insertDocument("card-stack", { id: "keep", type: "card-stack" });

    expect(observed).toEqual(["keep"]);
  });

  it("prepareInsert runs before afterInsert for a single insert", () => {
    const order: Array<string> = [];
    const store = makeHookStore({
      prepareInsert: (_type, doc) => {
        order.push("prepare");
        return doc;
      },
      afterInsert: () => order.push("after"),
    });

    store.insertDocument("card-stack", { id: "1", type: "card-stack" });

    expect(order).toEqual(["prepare", "after"]);
  });
});

// =============================================================================
// Store.find — state transitions on the returned handle
// =============================================================================

describe("Store.find — idle (no fetch)", () => {
  it("returns an idle handle when id is null", () => {
    const handle = store.find("user", null);

    expect(handle.value).toBeUndefined();
    expect(handle.isFetching).toBe(false);
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("pending");
    expect(handle.promise).toBeUndefined();
  });

  it("returns an idle handle when id is undefined", () => {
    const handle = store.find("user", undefined);
    expect(handle.value).toBeUndefined();
    expect(handle.isFetching).toBe(false);
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("pending");
  });
});

describe("Store.find — already in memory (fast path)", () => {
  it("returns a SUCCESS handle and never touches the network", async () => {
    const user = makeUser("1");
    store.insertDocument("user", user);

    const handle = store.find("user", "1");

    expect(handle.value).not.toBeUndefined();
    expect(unwrap(handle.value)).toBe(user); // reactive proxy over the exact object
    expect(handle.isFetching).toBe(false);
    expect(handle.status).toBe("success");

    await flushCoalescer();
    expect(requests()).toEqual([]); // no fetch ever happened
  });
});

describe("Store.insertDocument — documents are live and reactive", () => {
  it("does NOT freeze the stored document — it can be mutated in place", () => {
    const user = makeUser("1");
    store.insertDocument("user", user);

    const stored = store.findInMemory("user", "1")!;
    // Not frozen: the document stays in the reactive graph (a frozen target is
    // handed back unwrapped by the kernel, dropping per-field reactivity).
    expect(Object.isFrozen(unwrap(stored))).toBe(false);
    // No copy: the stored value is the exact object inserted, behind a proxy.
    expect(unwrap(stored)).toBe(user);
    // A top-level write succeeds. The old freeze was shallow — it rejected
    // exactly this top-level write while letting nested writes through — so a
    // top-level write (not a nested one) is what proves the doc is unfrozen.
    expect(() => {
      stored.attributes = { ...user.attributes, firstName: "Ada" };
    }).not.toThrow();
    expect(stored.attributes.firstName).toBe("Ada");
    expect(user.attributes.firstName).toBe("Ada"); // same underlying object
  });

  it("re-renders only the readers of the field mutated in place", () => {
    store.insertDocument("user", makeUser("1", { firstName: "User1", lastName: "Original" }));
    const handle = store.find("user", "1");

    const firstNameReads: Array<string | undefined> = [];
    effect(() => {
      firstNameReads.push(handle.value?.attributes.firstName);
    });
    const lastNameReads: Array<string | undefined> = [];
    effect(() => {
      lastNameReads.push(handle.value?.attributes.lastName);
    });
    expect(firstNameReads).toEqual(["User1"]);
    expect(lastNameReads).toEqual(["Original"]);

    // Mutate only firstName in place — the firstName subscriber re-fires, no
    // reinsert; the sibling lastName subscriber does NOT re-run. That second
    // assertion is the "only" in fine-grained: coarse, whole-doc tracking would
    // re-run both.
    store.findInMemory("user", "1")!.attributes.firstName = "Ada";
    expect(firstNameReads.at(-1)).toBe("Ada");
    expect(lastNameReads).toEqual(["Original"]); // never re-ran
  });

  it("accepts an already-frozen document the consumer froze (opts out of reactivity)", () => {
    // The store never freezes for you, but it tolerates a consumer-frozen doc:
    // it round-trips by reference (frozen targets are returned unwrapped) — at
    // the cost of per-field reactivity, which is the consumer's choice.
    const user = Object.freeze(makeUser("2"));
    expect(() => store.insertDocument("user", user)).not.toThrow();
    expect(store.findInMemory("user", "2")).toBe(user);
  });
});

describe("Store.find — not in memory (delegates to internal batching)", () => {
  it("returns a PENDING handle while the fetch is in flight", () => {
    const handle = store.find("user", "1");

    expect(handle.value).toBeUndefined();
    expect(handle.isFetching).toBe(true);
    expect(handle.status).toBe("pending");
  });

  it("transitions to SUCCESS once the network resolves", async () => {
    const handle = store.find("user", "1");
    expect(handle.value === undefined && handle.isFetching).toBe(true);

    await flushCoalescer();

    expect(handle.value).not.toBeUndefined();
    expect(handle.value?.id).toBe("1");
    expect(handle.value?.attributes.firstName).toBe("User1");
    expect(handle.isFetching).toBe(false);
    expect(handle.status).toBe("success");
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
    expect(handle.value === undefined && handle.isFetching).toBe(true);

    await flushCoalescer();

    expect(handle.value).not.toBeUndefined();
    expect(handle.value?.id).toBe("42");
    expect(handle.value?.attributes.title).toBe("Post42");
  });
});

describe("Store.find — server errors surface as ERROR", () => {
  it("transitions to ERROR when the server returns 500", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );

    const handle = store.find("user", "1");
    await flushCoalescer();

    expect(handle.value === undefined && handle.error !== undefined).toBe(true);
    expect(handle.status).toBe("error");
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
    expect(handle.value === undefined && handle.isFetching).toBe(true);

    store.insertDocument("user", makeUser("1", { firstName: "Pushed" }));

    expect(handle.value).not.toBeUndefined();
    expect(handle.value?.attributes.firstName).toBe("Pushed");
  });

  it("re-exposes fresher data when insertDocument overwrites a cached doc", async () => {
    const handle = store.find("user", "1");
    await flushCoalescer();
    expect(handle.value?.attributes.firstName).toBe("User1");

    store.insertDocument("user", makeUser("1", { firstName: "Renamed" }));
    expect(handle.value?.attributes.firstName).toBe("Renamed");
  });

  it("lets a later fetch overwrite a mid-flight local insert (last-write-wins)", async () => {
    // Spec: if insertDocument lands during an in-flight fetch for the same
    // key, the local insert wins first, then the fetch resolves and
    // overwrites. No reconciliation — the fetched value wins.
    const handle = store.find("user", "1");
    store.insertDocument("user", makeUser("1", { firstName: "Local" }));
    expect(handle.value?.attributes.firstName).toBe("Local");

    await flushCoalescer();

    // MSW handler returns firstName: "User1"; that wins over the local insert.
    expect(handle.value?.attributes.firstName).toBe("User1");
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
    expect(handle.value === undefined && handle.error !== undefined).toBe(true);

    // A fresh insert (e.g. from a socket push) flips the handle back to SUCCESS.
    store.insertDocument("user", makeUser("1", { firstName: "Recovered" }));

    expect(handle.value).not.toBeUndefined();
    // A fresh value supersedes the prior error.
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("success");
    expect(handle.promise).not.toBe(rejectedPromise);
    expect(handle.value?.attributes.firstName).toBe("Recovered");
  });
});

// =============================================================================
// Store.clearMemory — effects on already-returned handles.
// =============================================================================

describe("Store.clearMemory — handle transitions", () => {
  it("flips SUCCESS handles to IDLE when there is no in-flight fetch", () => {
    store.insertDocument("user", makeUser("1"));
    const handle = store.find("user", "1");
    expect(handle.value).not.toBeUndefined();

    store.clearMemory();

    expect(handle.value).toBeUndefined();
    expect(handle.isFetching).toBe(false);
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("pending");
    expect(handle.promise).toBeUndefined();
  });

  it("leaves PENDING handles PENDING — the in-flight fetch is not cancelled", async () => {
    const handle = store.find("user", "1");
    expect(handle.value === undefined && handle.isFetching).toBe(true);

    store.clearMemory();
    expect(handle.value === undefined && handle.isFetching).toBe(true);

    await flushCoalescer();

    // Fetch completed; processor re-populated the doc on the (now cleared) store.
    expect(handle.value).not.toBeUndefined();
    expect(handle.value?.id).toBe("1");
  });

  it("clears settled error handles so retries start from a fresh promise", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );

    const handle = store.find("user", "1");
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

    const retried = store.find("user", "1");
    expect(retried).toBe(handle);
    expect(handle.promise).toBeInstanceOf(Promise);
    expect(handle.promise).not.toBe(rejectedPromise);

    await flushCoalescer();

    expect(handle.value).not.toBeUndefined();
    expect(handle.value?.id).toBe("1");
  });
});

describe("Store.insertDocument — updates IDLE and ERROR handles to SUCCESS", () => {
  it("updates an IDLE handle to SUCCESS when insertDocument is called directly", () => {
    // Seed a doc so find() returns SUCCESS immediately (no fetch triggered)
    store.insertDocument("user", makeUser("42"));
    const handle = store.find("user", "42");
    expect(handle.value).not.toBeUndefined();

    // Clear memory so the handle becomes IDLE (no in-flight fetch)
    store.clearMemory();
    expect(handle.value).toBeUndefined();
    expect(handle.isFetching).toBe(false);
    expect(handle.status).toBe("pending");

    // Now insert the document directly (no fetch involved)
    const user = makeUser("42");
    store.insertDocument("user", user);

    expect(handle.value).not.toBeUndefined();
    expect(unwrap(handle.value)).toBe(user); // reactive proxy over the exact object
    expect(handle.isFetching).toBe(false);
    expect(handle.status).toBe("success");
  });

  it("updates an ERROR handle to SUCCESS when insertDocument is called directly", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () =>
        HttpResponse.json({ error: "not found" }, { status: 404 }),
      ),
    );

    const handle = store.find("user", "err1");
    await flushCoalescer();
    expect(handle.value === undefined && handle.error !== undefined).toBe(true);

    // Recover by inserting directly
    const user = makeUser("err1");
    store.insertDocument("user", user);

    expect(handle.value).not.toBeUndefined();
    expect(unwrap(handle.value)).toBe(user); // reactive proxy over the exact object
    // A fresh value supersedes any prior error: error is cleared and the
    // handle's status flips to success.
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("success");
  });
});

// =============================================================================
// Handle reactivity — effects subscribed to handle fields fire on transitions.
//
// React UI code binds to `handle.status`, `handle.data`, and `handle.error`
// via tracked() / signal effects. Verifying that those reads actually
// re-fire on transitions is the contract that makes the API usable from a
// render loop. The previous tests verified values *after* transitions but
// never wrapped reads in effect() — a regression that broke the reactivity
// while keeping post-hoc reads correct would slip through.
// =============================================================================

describe("Store.find — handle is reactive", () => {
  it("an effect tracking handle fields fires on PENDING -> SUCCESS via fetch", async () => {
    const handle = store.find("user", "1");

    const stateHistory: Array<string> = [];
    effect(() => {
      stateHistory.push(
        `${handle.value === undefined ? "Absent" : "Present"}/${handle.isFetching}`,
      );
    });
    expect(stateHistory).toEqual(["Absent/true"]);

    await flushCoalescer();
    expect(stateHistory.at(-1)).toBe("Present/false");
  });

  it("an effect tracking handle.value fires when an external insert lands", () => {
    const handle = store.find("user", "1");

    const firstNameHistory: Array<string | undefined> = [];
    effect(() => {
      firstNameHistory.push(handle.value?.attributes.firstName);
    });
    expect(firstNameHistory).toEqual([undefined]);

    store.insertDocument("user", makeUser("1", { firstName: "Pushed" }));
    expect(firstNameHistory.at(-1)).toBe("Pushed");
  });

  it("an effect tracking handle.error fires on PENDING -> ERROR", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );
    const handle = store.find("user", "1");

    const errorHistory: Array<string | undefined> = [];
    effect(() => {
      errorHistory.push(handle.error?.message);
    });
    expect(errorHistory).toEqual([undefined]);

    await flushCoalescer();
    expect(errorHistory.at(-1)).toMatch(/silo|adapter/i);

    // A fresh value supersedes the error: the error clears and the value lands.
    store.insertDocument("user", makeUser("1", { firstName: "Recovered" }));
    expect(handle.value).not.toBeUndefined();
    expect(handle.error).toBeUndefined();
    expect(errorHistory.at(-1)).toBeUndefined();
  });

  it("isFetching toggles independently of value subscribers", async () => {
    const handle = store.find("user", "1");

    const fetchingHistory: Array<boolean> = [];
    effect(() => {
      fetchingHistory.push(handle.isFetching);
    });
    expect(fetchingHistory).toEqual([true]);

    await flushCoalescer();
    expect(fetchingHistory.at(-1)).toBe(false);
  });
});

describe("Store query memory operations", () => {
  it("accepts an already-frozen query result", () => {
    const frozenDashboard = Object.freeze(makeDashboard({ totalActiveUsers: 999 }));
    const params: DashboardParams = { workspaceId: 999, filters: { active: true } };

    store.insertQueryResult("dashboard", params, frozenDashboard);
    const inMemory = store.findQueryInMemory("dashboard", params);
    expect(inMemory?.totalActiveUsers).toBe(999);
    expect(Object.isFrozen(frozenDashboard)).toBe(true);
  });

  it("clearMemory resets query handles", () => {
    const params: DashboardParams = { workspaceId: 10, filters: { active: true } };
    store.insertQueryResult("dashboard", params, makeDashboard({ totalActiveUsers: 100 }));

    const inMemory = store.findQueryInMemory("dashboard", params);
    expect(inMemory?.totalActiveUsers).toBe(100);

    store.clearMemory();

    const afterClear = store.findQueryInMemory("dashboard", params);
    expect(afterClear).toBeUndefined();
  });

  it("supports array-valued query params", async () => {
    type ArrayTypes = { item: { id: string } };
    type ArrayQueries = { tagged: { params: { tags: string[] }; result: { count: number } } };

    const arrayStore = createDocumentStore<ArrayTypes, ArrayQueries>({
      models: { item: { adapter: { find: effectFind("item", async () => []) } } },
      queries: {
        tagged: {
          adapter: {
            find: effectFind("tagged", async (paramsList: Array<{ tags: string[] }>) =>
              paramsList.map((p) => ({ count: p.tags.length })),
            ),
          },
        },
      },
    });

    const h = arrayStore.findQuery("tagged", { tags: ["a", "b", "c"] });
    await vi.advanceTimersByTimeAsync(20);
    await h.promise;
    expect(h.value?.count).toBe(3);
  });
});

describe("Store.find — unconfigured type validation", () => {
  it("throws eagerly for an unconfigured model type instead of stranding the drain", () => {
    expect(() => store.find("nope" as never, "1")).toThrow(/no model "nope" is configured/);
  });

  it("does not poison sibling fetches queued in the same window", async () => {
    expect(() => store.find("nope" as never, "1")).toThrow();
    const handle = store.find("user", "1");
    await flushCoalescer();
    expect(handle.isFetching).toBe(false);
    expect(handle.value).toBeDefined();
  });

  it("still returns the idle handle for a null id without validating", () => {
    const handle = store.find("nope" as never, null);
    expect(handle.status).toBe("pending");
    expect(handle.isFetching).toBe(false);
  });
});

describe("Store.findQuery — null params before type validation", () => {
  it("returns the idle handle for null params even when the type is not configured", () => {
    // The conditional-read idiom `findQuery(type, ready ? params : null)` must
    // keep working while the type is feature-flagged out of config.
    const handle = store.findQuery("ghost" as never, null);
    expect(handle.status).toBe("pending");
    expect(handle.isFetching).toBe(false);
  });

  it("still throws for non-null params on an unconfigured type", () => {
    expect(() => store.findQuery("ghost" as never, { q: "x" } as never)).toThrow(
      /no query "ghost" is configured/,
    );
  });
});

describe("Store.find — cached documents of unconfigured types stay readable", () => {
  // A processor may sideload documents under a type that has no model config —
  // JSON-API `included` resources are inserted by their envelope `type`, and
  // the relationship hooks read them back with `store.find(ref.type, ref.id)`.
  // Validation only guards the fetch path: a cached handle resolves from
  // memory without ever needing an adapter.
  it("returns a cached sideloaded document without validating its type", () => {
    store.insertDocument("comment" as never, { id: "c1", body: "hi" } as never);

    const handle = store.find("comment" as never, "c1");

    expect(handle.value).toEqual({ id: "c1", body: "hi" });
    expect(handle.status).toBe("success");
    expect(handle.isFetching).toBe(false);
  });

  it("returns a cached query result without validating its query type", () => {
    store.insertQueryResult("ghost" as never, { q: "x" } as never, { total: 3 } as never);

    const handle = store.findQuery("ghost" as never, { q: "x" } as never);

    expect(handle.value).toEqual({ total: 3 });
    expect(handle.status).toBe("success");
    expect(handle.isFetching).toBe(false);
  });
});
