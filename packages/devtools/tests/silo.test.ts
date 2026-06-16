import { getSiloDevtools, snapshotSilo } from "@supergrain/devtools";
import { effect } from "@supergrain/kernel";
import { createDocumentStore, type DocumentStore } from "@supergrain/silo";
import { SILO_DEVTOOLS } from "@supergrain/silo/devtools";
import { describe, expect, it } from "vitest";

type Models = {
  user: { id: string; name: string };
  post: { id: string; title: string };
};
type Queries = {
  search: { params: { q: string }; result: { ids: Array<string> } };
};

// A store whose adapters never run — we populate it directly via insert*, so
// inspecting it never triggers a fetch (the whole point of the bridge).
function makeStore(): DocumentStore<Models, Queries> {
  return createDocumentStore<Models, Queries>({
    models: {
      user: { adapter: { find: () => Promise.resolve([]) } },
      post: { adapter: { find: () => Promise.resolve([]) } },
    },
    queries: {
      search: { adapter: { find: () => Promise.resolve([]) } },
    },
  });
}

describe("getSiloDevtools()", () => {
  it("returns a bridge for a store and undefined otherwise", () => {
    const store = makeStore();
    expect(getSiloDevtools(store)).toBeDefined();
    expect(getSiloDevtools({})).toBeUndefined();
    expect(getSiloDevtools(null)).toBeUndefined();
    expect(getSiloDevtools(42)).toBeUndefined();
  });

  it("attaches the bridge non-enumerably", () => {
    const store = makeStore();
    const desc = Object.getOwnPropertyDescriptor(store, SILO_DEVTOOLS);
    expect(desc?.enumerable).toBe(false);
    expect(Object.keys(store)).not.toContain("state");
  });
});

describe("snapshotSilo()", () => {
  it("returns undefined for a non-store", () => {
    expect(snapshotSilo({})).toBeUndefined();
    expect(snapshotSilo(undefined)).toBeUndefined();
  });

  it("lists inserted documents with status and metadata", () => {
    const store = makeStore();
    store.insertDocument("user", { id: "1", name: "Ada" });

    const snap = snapshotSilo(store);
    expect(snap).toBeDefined();
    const users = snap!.documents.find((g) => g.type === "user");
    expect(users?.entries).toHaveLength(1);
    const entry = users!.entries[0]!;
    expect(entry.key).toBe("1");
    expect(entry.status).toBe("success");
    expect(entry.hasValue).toBe(true);
    expect(entry.hasError).toBe(false);
    expect(entry.fetchedAt).not.toBeNull();
    // No value serialized unless requested.
    expect(entry.value).toBeUndefined();
  });

  it("includes configured-but-empty types", () => {
    const snap = snapshotSilo(makeStore())!;
    expect(snap.documents.map((g) => g.type).sort()).toEqual(["post", "user"]);
    expect(snap.queries.map((g) => g.type)).toEqual(["search"]);
    expect(snap.documents.find((g) => g.type === "post")?.entries).toHaveLength(0);
  });

  it("lists query results keyed by their params", () => {
    const store = makeStore();
    store.insertQueryResult("search", { q: "ada" }, { ids: ["1"] });

    const snap = snapshotSilo(store)!;
    const search = snap.queries.find((g) => g.type === "search");
    expect(search?.entries).toHaveLength(1);
    expect(search!.entries[0]!.key).toBe(`{"q":"ada"}`);
    expect(search!.entries[0]!.status).toBe("success");
  });

  it("serializes the value only for entries the predicate selects", () => {
    const store = makeStore();
    store.insertDocument("user", { id: "1", name: "Ada" });
    store.insertDocument("user", { id: "2", name: "Bob" });

    const snap = snapshotSilo(store, {
      includeValue: (kind, type, key) => kind === "document" && type === "user" && key === "1",
    })!;
    const entries = snap.documents.find((g) => g.type === "user")!.entries;
    const ada = entries.find((e) => e.key === "1")!;
    const bob = entries.find((e) => e.key === "2")!;
    expect(bob.value).toBeUndefined();
    expect(ada.value?.t).toBe("object");
    if (ada.value?.t === "object") {
      expect(ada.value.entries.find(([k]) => k === "name")?.[1]).toEqual({
        t: "string",
        value: "Ada",
      });
    }
  });

  it("reports totals for fetching and errored handles", () => {
    const store = makeStore();
    store.insertDocument("user", { id: "1", name: "Ada" });
    store.insertDocument("user", { id: "2", name: "Bob" });
    store.insertQueryResult("search", { q: "x" }, { ids: [] });

    const snap = snapshotSilo(store)!;
    expect(snap.totals.documents).toBe(2);
    expect(snap.totals.queries).toBe(1);
    expect(snap.totals.fetching).toBe(0);
    expect(snap.totals.errored).toBe(0);
  });

  it("reflects clearMemory through the bridge", () => {
    const store = makeStore();
    store.insertDocument("user", { id: "1", name: "Ada" });
    const bridge = getSiloDevtools(store)!;

    bridge.clearMemory();

    const snap = snapshotSilo(store)!;
    const entry = snap.documents.find((g) => g.type === "user")!.entries[0]!;
    expect(entry.status).toBe("pending");
    expect(entry.hasValue).toBe(false);
  });

  it("is reactive: re-runs in a kernel effect when the store changes", () => {
    const store = makeStore();
    store.insertDocument("user", { id: "1", name: "Ada" });

    let runs = 0;
    const stop = effect(() => {
      snapshotSilo(store);
      runs++;
    });
    const initial = runs;
    expect(initial).toBeGreaterThan(0);

    store.insertDocument("user", { id: "2", name: "Bob" });
    expect(runs).toBeGreaterThan(initial);

    const afterInsert = runs;
    store.insertDocument("user", { id: "1", name: "Ada (edited)" });
    expect(runs).toBeGreaterThan(afterInsert);

    stop();
  });
});
