import { effect } from "@supergrain/kernel";
import { Effect } from "effect";
import { http, HttpResponse } from "msw";
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";

import { AdapterError } from "../src";
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
} from "./example-app";
import { setupFakeTimers } from "./setup/timers";

/** Narrow a handle's `data` region to Present and return its value. */
function present<T>(h: { data: { _tag: "Absent" } | { _tag: "Present"; value: T } }): T {
  if (h.data._tag !== "Present") throw new Error(`expected Present, got ${h.data._tag}`);
  return h.data.value;
}

/** Wrap a Promise-returning function as an Effect-returning adapter `find`. */
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

    expect(handle.data._tag).toBe("Absent");
    expect(handle.fetch._tag).toBe("Idle");
    expect(handle.promise).toBeUndefined();
  });

  it("returns an idle handle when id is undefined", () => {
    const handle = store.find("user", undefined);
    expect(handle.data._tag).toBe("Absent");
    expect(handle.fetch._tag).toBe("Idle");
  });
});

describe("Store.find — already in memory (fast path)", () => {
  it("returns a SUCCESS handle and never touches the network", async () => {
    const user = makeUser("1");
    store.insertDocument("user", user);

    const handle = store.find("user", "1");

    expect(handle.data._tag).toBe("Present");
    expect(present(handle)).toBe(user);
    expect(handle.fetch._tag).toBe("Idle");

    await flushCoalescer();
    expect(requests()).toEqual([]); // no fetch ever happened
  });
});

describe("Store.find — not in memory (delegates to internal batching)", () => {
  it("returns a PENDING handle while the fetch is in flight", () => {
    const handle = store.find("user", "1");

    expect(handle.data._tag).toBe("Absent");
    expect(handle.fetch._tag).toBe("Fetching");
  });

  it("transitions to SUCCESS once the network resolves", async () => {
    const handle = store.find("user", "1");
    expect(handle.data._tag === "Absent" && handle.fetch._tag === "Fetching").toBe(true);

    await flushCoalescer();

    expect(handle.data._tag).toBe("Present");
    expect(present(handle).id).toBe("1");
    expect(present(handle).attributes.firstName).toBe("User1");
    expect(handle.fetch._tag).toBe("Idle");
    expect(handle.data._tag === "Present" && handle.data.fetchedAt).toBeInstanceOf(Date);
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
    expect(handle.data._tag === "Absent" && handle.fetch._tag === "Fetching").toBe(true);

    await flushCoalescer();

    expect(handle.data._tag).toBe("Present");
    expect(present(handle).id).toBe("42");
    expect(present(handle).attributes.title).toBe("Post42");
  });
});

describe("Store.find — server errors surface as ERROR", () => {
  it("transitions to ERROR when the server returns 500", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );

    const handle = store.find("user", "1");
    await flushCoalescer();

    expect(handle.data._tag === "Absent" && handle.fetch._tag === "Failed").toBe(true);
    expect(handle.fetch._tag === "Failed" && handle.fetch.error).toBeInstanceOf(Error);
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
    expect(handle.data._tag === "Absent" && handle.fetch._tag === "Fetching").toBe(true);

    store.insertDocument("user", makeUser("1", { firstName: "Pushed" }));

    expect(handle.data._tag).toBe("Present");
    expect(present(handle).attributes.firstName).toBe("Pushed");
  });

  it("re-exposes fresher data when insertDocument overwrites a cached doc", async () => {
    const handle = store.find("user", "1");
    await flushCoalescer();
    expect(present(handle).attributes.firstName).toBe("User1");

    store.insertDocument("user", makeUser("1", { firstName: "Renamed" }));
    expect(present(handle).attributes.firstName).toBe("Renamed");
  });

  it("lets a later fetch overwrite a mid-flight local insert (last-write-wins)", async () => {
    // Spec: if insertDocument lands during an in-flight fetch for the same
    // key, the local insert wins first, then the fetch resolves and
    // overwrites. No reconciliation — the fetched value wins.
    const handle = store.find("user", "1");
    store.insertDocument("user", makeUser("1", { firstName: "Local" }));
    expect(present(handle).attributes.firstName).toBe("Local");

    await flushCoalescer();

    // MSW handler returns firstName: "User1"; that wins over the local insert.
    expect(present(handle).attributes.firstName).toBe("User1");
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
    expect(handle.data._tag === "Absent" && handle.fetch._tag === "Failed").toBe(true);

    // A fresh insert (e.g. from a socket push) flips the handle back to SUCCESS.
    store.insertDocument("user", makeUser("1", { firstName: "Recovered" }));

    expect(handle.data._tag).toBe("Present");
    expect(handle.promise).not.toBe(rejectedPromise);
    expect(present(handle).attributes.firstName).toBe("Recovered");
  });
});

// =============================================================================
// Store.clearMemory — effects on already-returned handles.
// =============================================================================

describe("Store.clearMemory — handle transitions", () => {
  it("flips SUCCESS handles to IDLE when there is no in-flight fetch", () => {
    store.insertDocument("user", makeUser("1"));
    const handle = store.find("user", "1");
    expect(handle.data._tag).toBe("Present");

    store.clearMemory();

    expect(handle.data._tag).toBe("Absent");
    expect(handle.fetch._tag).toBe("Idle");
    expect(handle.promise).toBeUndefined();
  });

  it("leaves PENDING handles PENDING — the in-flight fetch is not cancelled", async () => {
    const handle = store.find("user", "1");
    expect(handle.data._tag === "Absent" && handle.fetch._tag === "Fetching").toBe(true);

    store.clearMemory();
    expect(handle.data._tag === "Absent" && handle.fetch._tag === "Fetching").toBe(true);

    await flushCoalescer();

    // Fetch completed; processor re-populated the doc on the (now cleared) store.
    expect(handle.data._tag).toBe("Present");
    expect(present(handle).id).toBe("1");
  });

  it("clears settled error handles so retries start from a fresh promise", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );

    const handle = store.find("user", "1");
    await flushCoalescer();

    const rejectedPromise = handle.promise;
    expect(handle.data._tag === "Absent" && handle.fetch._tag === "Failed").toBe(true);
    expect(handle.fetch._tag === "Failed" && handle.fetch.error).toBeInstanceOf(Error);

    store.clearMemory();
    expect(handle.data._tag).toBe("Absent");
    expect(handle.fetch._tag).toBe("Idle");
    expect(handle.promise).toBeUndefined();

    server.resetHandlers();

    const retried = store.find("user", "1");
    expect(retried).toBe(handle);
    expect(handle.promise).toBeInstanceOf(Promise);
    expect(handle.promise).not.toBe(rejectedPromise);

    await flushCoalescer();

    expect(handle.data._tag).toBe("Present");
    expect(present(handle).id).toBe("1");
  });
});

describe("Store.insertDocument — updates IDLE and ERROR handles to SUCCESS", () => {
  it("updates an IDLE handle to SUCCESS when insertDocument is called directly", () => {
    // Seed a doc so find() returns SUCCESS immediately (no fetch triggered)
    store.insertDocument("user", makeUser("42"));
    const handle = store.find("user", "42");
    expect(handle.data._tag).toBe("Present");

    // Clear memory so the handle becomes IDLE (no in-flight fetch)
    store.clearMemory();
    expect(handle.data._tag).toBe("Absent");
    expect(handle.fetch._tag).toBe("Idle");

    // Now insert the document directly (no fetch involved)
    const user = makeUser("42");
    store.insertDocument("user", user);

    expect(handle.data._tag).toBe("Present");
    expect(present(handle)).toBe(user);
    expect(handle.fetch._tag).toBe("Idle");
  });

  it("updates an ERROR handle to SUCCESS when insertDocument is called directly", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () =>
        HttpResponse.json({ error: "not found" }, { status: 404 }),
      ),
    );

    const handle = store.find("user", "err1");
    await flushCoalescer();
    expect(handle.data._tag === "Absent" && handle.fetch._tag === "Failed").toBe(true);

    // Recover by inserting directly
    const user = makeUser("err1");
    store.insertDocument("user", user);

    expect(handle.data._tag).toBe("Present");
    expect(present(handle)).toBe(user);
    // Insert doesn't touch the fetch region; the prior Failed is retained
    // (stale-while-revalidate keeps the two regions orthogonal).
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
  it("an effect tracking handle.fetch fires on PENDING -> SUCCESS via fetch", async () => {
    const handle = store.find("user", "1");

    const stateHistory: Array<string> = [];
    effect(() => {
      stateHistory.push(`${handle.data._tag}/${handle.fetch._tag}`);
    });
    expect(stateHistory).toEqual(["Absent/Fetching"]);

    await flushCoalescer();
    expect(stateHistory.at(-1)).toBe("Present/Idle");
  });

  it("an effect tracking handle.data fires when an external insert lands", () => {
    const handle = store.find("user", "1");

    const firstNameHistory: Array<string | undefined> = [];
    effect(() => {
      firstNameHistory.push(
        handle.data._tag === "Present" ? handle.data.value.attributes.firstName : undefined,
      );
    });
    expect(firstNameHistory).toEqual([undefined]);

    store.insertDocument("user", makeUser("1", { firstName: "Pushed" }));
    expect(firstNameHistory.at(-1)).toBe("Pushed");
  });

  it("an effect tracking handle.fetch error fires on PENDING -> ERROR", async () => {
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );
    const handle = store.find("user", "1");

    const errorHistory: Array<string | undefined> = [];
    effect(() => {
      errorHistory.push(handle.fetch._tag === "Failed" ? handle.fetch.error.message : undefined);
    });
    expect(errorHistory).toEqual([undefined]);

    await flushCoalescer();
    expect(errorHistory.at(-1)).toMatch(/silo|adapter/i);

    // An external insert lands data (data region), but leaves the orthogonal
    // fetch region's Failed state untouched (stale-while-revalidate). The
    // error effect therefore does NOT re-fire from the insert.
    store.insertDocument("user", makeUser("1", { firstName: "Recovered" }));
    expect(handle.data._tag).toBe("Present");
  });

  it("the fetch region toggles independently of data subscribers", async () => {
    const handle = store.find("user", "1");

    const fetchingHistory: Array<boolean> = [];
    effect(() => {
      fetchingHistory.push(handle.fetch._tag === "Fetching");
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
    expect(present(h).count).toBe(3);
  });
});
