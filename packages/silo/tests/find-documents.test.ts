import { effect } from "@supergrain/kernel";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../src/errors";
import {
  API_BASE,
  clearRequests,
  flushCoalescer,
  initStore,
  makeUser,
  requests,
  server,
} from "./example-app";
import { setupFakeTimers } from "./setup/timers";

// =============================================================================
// store.findDocumentsIndividually / store.findDocumentsTogether — the two multi-id reads,
// both batched over store.find (stable + idempotent, one handle per id).
//
// - findDocumentsIndividually(type, ids) → Array<DocumentHandle>: one independent
//   handle per id, in id order; each settles on its own.
// - findDocumentsTogether(type, ids) → DocumentsTogetherHandle: an all-or-nothing
//   batch handle — pending until every id loads, success (value = all docs in
//   id order) once they do, error if any fails.
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

// A handler that answers the bulk /users endpoint but drops the given ids from
// its response, so those ids settle as NotFoundError while their siblings load.
function omitUserIds(...omit: Array<string>): void {
  server.use(
    http.get(`${API_BASE}/users`, ({ request }) => {
      const ids = new URL(request.url).searchParams.getAll("id");
      return HttpResponse.json(ids.filter((id) => !omit.includes(id)).map((id) => makeUser(id)));
    }),
  );
}

// =============================================================================
// findDocumentsIndividually
// =============================================================================

describe("store.findDocumentsIndividually — idle + empty edges", () => {
  it("returns an empty array for null / undefined ids, touching no network", async () => {
    expect(store.findDocumentsIndividually("user", null)).toEqual([]);
    expect(store.findDocumentsIndividually("user", undefined)).toEqual([]);

    await flushCoalescer();
    expect(requests()).toEqual([]);
  });

  it("returns an empty array for empty ids, touching no network", async () => {
    expect(store.findDocumentsIndividually("user", [])).toEqual([]);

    await flushCoalescer();
    expect(requests()).toEqual([]);
  });
});

describe("store.findDocumentsIndividually — handles", () => {
  it("collects one handle per id, in id order, each === store.find(id)", () => {
    const handles = store.findDocumentsIndividually("user", ["1", "2", "3"]);

    expect(handles).toHaveLength(3);
    // Idempotent: the handles are the very objects store.find hands out.
    expect(handles[0]).toBe(store.find("user", "1"));
    expect(handles[1]).toBe(store.find("user", "2"));
    expect(handles[2]).toBe(store.find("user", "3"));
  });

  it("returns a fresh array each call, but the same inner handles", () => {
    const a = store.findDocumentsIndividually("user", ["1", "2"]);
    const b = store.findDocumentsIndividually("user", ["1", "2"]);

    // The array is intentionally not stable (useDocumentsIndividually layers
    // that on top); the handles inside are stable — find is idempotent.
    expect(a).not.toBe(b);
    expect(a[0]).toBe(b[0]);
    expect(a[1]).toBe(b[1]);
  });

  it("triggers a single batched fetch for all ids", async () => {
    store.findDocumentsIndividually("user", ["1", "2", "3"]);

    await flushCoalescer();

    const userReqs = requests().filter((r) => r.url.pathname === "/users");
    expect(userReqs).toHaveLength(1);
    expect(userReqs[0].url.searchParams.getAll("id")).toEqual(["1", "2", "3"]);
  });

  it("each handle settles to its value independently, in id order", async () => {
    const handles = store.findDocumentsIndividually("user", ["1", "2", "3"]);
    expect(handles.every((h) => h.status === "pending")).toBe(true);

    await flushCoalescer();

    expect(handles.map((h) => h.status)).toEqual(["success", "success", "success"]);
    expect(handles.map((h) => h.value?.id)).toEqual(["1", "2", "3"]);
  });

  it("keeps an errored handle in place (in id order) alongside its successful siblings", async () => {
    omitUserIds("2"); // id 2 → NotFoundError, 1 and 3 succeed

    const handles = store.findDocumentsIndividually("user", ["1", "2", "3"]);
    await flushCoalescer();

    expect(handles[0].status).toBe("success");
    expect(handles[1].status).toBe("error");
    expect(handles[1].error).toBeInstanceOf(NotFoundError);
    expect(handles[2].status).toBe("success");
  });

  it("re-runs a subscriber when one of its handles settles", async () => {
    const handles = store.findDocumentsIndividually("user", ["1", "2"]);

    const seen: Array<Array<string>> = [];
    effect(() => {
      seen.push(handles.filter((h) => h.status === "success").map((h) => h.value!.id));
    });
    expect(seen).toEqual([[]]);

    await flushCoalescer();

    expect(seen.at(-1)).toEqual(["1", "2"]);
  });
});

// =============================================================================
// findDocumentsTogether — idle + empty edges
// =============================================================================

describe("store.findDocumentsTogether — idle (no ids)", () => {
  it("returns an idle handle for null ids, touching no network", async () => {
    const together = store.findDocumentsTogether("user", null);

    expect(together.status).toBe("pending");
    expect(together.value).toBeUndefined();
    expect(together.error).toBeUndefined();
    expect(together.isFetching).toBe(false);
    expect(together.promise).toBeUndefined();

    await flushCoalescer();
    expect(requests()).toEqual([]);
  });

  it("returns an idle handle for undefined ids", () => {
    const together = store.findDocumentsTogether("user", undefined);
    expect(together.status).toBe("pending");
    expect(together.value).toBeUndefined();
  });
});

describe("store.findDocumentsTogether — empty ids array", () => {
  it("is immediately success with an empty value and no fetch", async () => {
    const together = store.findDocumentsTogether("user", []);

    expect(together.status).toBe("success");
    expect(together.value).toEqual([]);
    expect(together.isFetching).toBe(false);

    await flushCoalescer();
    expect(requests()).toEqual([]);
  });

  it("its promise resolves to an empty array", async () => {
    const together = store.findDocumentsTogether("user", []);
    await expect(together.promise).resolves.toEqual([]);
  });
});

// =============================================================================
// findDocumentsTogether — pending → success (all-or-nothing)
// =============================================================================

describe("store.findDocumentsTogether — all-or-nothing loading", () => {
  it("stays pending with no value until every id has loaded, then exposes all in id order", async () => {
    const together = store.findDocumentsTogether("user", ["1", "2", "3"]);

    expect(together.status).toBe("pending");
    expect(together.value).toBeUndefined();
    expect(together.isFetching).toBe(true);

    await flushCoalescer();

    expect(together.status).toBe("success");
    expect(together.value?.map((u) => u.id)).toEqual(["1", "2", "3"]);
    expect(together.isFetching).toBe(false);
  });

  it("reads a fully-cached batch as success with no loading state", async () => {
    store.insertDocument("user", makeUser("1", { firstName: "Ada" }));
    store.insertDocument("user", makeUser("2", { firstName: "Grace" }));

    const together = store.findDocumentsTogether("user", ["1", "2"]);

    expect(together.status).toBe("success");
    expect(together.value?.map((u) => u.attributes.firstName)).toEqual(["Ada", "Grace"]);
    expect(together.error).toBeUndefined(); // no failing handle → no error
    await expect(together.promise).resolves.toHaveLength(2);
  });

  it("exposes a stable value array reconciled in place across a wholesale replace", async () => {
    const together = store.findDocumentsTogether("user", ["1", "2"]);
    await flushCoalescer();

    const value = together.value;
    expect(value?.map((u) => u.id)).toEqual(["1", "2"]);

    // Wholesale-replace id 1: same all-or-nothing success, same array identity,
    // slot 0 updated in place.
    store.insertDocument("user", makeUser("1", { firstName: "Ada" }));

    expect(together.value).toBe(value);
    expect(together.value?.[0].attributes.firstName).toBe("Ada");
  });
});

// =============================================================================
// findDocumentsTogether — a failure is terminal
// =============================================================================

describe("store.findDocumentsTogether — a partial failure", () => {
  it("goes to error with no value and surfaces the failing error", async () => {
    omitUserIds("2"); // id 2 → NotFoundError

    const together = store.findDocumentsTogether("user", ["1", "2", "3"]);
    await flushCoalescer();

    expect(together.status).toBe("error");
    expect(together.value).toBeUndefined();
    expect(together.error).toBeInstanceOf(NotFoundError);
  });
});

// =============================================================================
// findDocumentsTogether — promise
// =============================================================================

describe("store.findDocumentsTogether — promise", () => {
  it("resolves with every value once they all succeed", async () => {
    const together = store.findDocumentsTogether("user", ["1", "2"]);
    const promise = together.promise;

    await flushCoalescer();

    await expect(promise).resolves.toEqual([
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2" }),
    ]);
  });

  it("rejects as soon as any id errors", async () => {
    omitUserIds("2");

    const together = store.findDocumentsTogether("user", ["1", "2", "3"]);
    const promise = together.promise;

    await flushCoalescer();

    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns a stable promise identity across reads while inputs are unchanged", () => {
    const together = store.findDocumentsTogether("user", ["1", "2"]);
    expect(together.promise).toBe(together.promise);
  });

  it("stays undefined while any handle is idle, and returns once every id refetches", async () => {
    const together = store.findDocumentsTogether("user", ["1", "2"]);
    await flushCoalescer();
    store.clearMemory(); // both idle, promises undefined

    // Re-request only id 1: id 2 is still idle (no fetch started), so there is
    // nothing the combined promise could resolve id 2's slot with — it must
    // stay undefined rather than fulfil with an `undefined` hole typed as T.
    store.find("user", "1");
    expect(together.promise).toBeUndefined();

    // Once every handle has a fetch again, the combined promise is back — and
    // it resolves with a real document in every slot.
    store.find("user", "2");
    const promise = together.promise;
    expect(promise).toBeInstanceOf(Promise);

    await flushCoalescer();
    await expect(promise).resolves.toEqual([
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2" }),
    ]);
  });

  it("falls back to undefined promise when every handle goes idle (clearMemory)", async () => {
    const together = store.findDocumentsTogether("user", ["1", "2"]);
    await flushCoalescer();
    expect(together.promise).toBeInstanceOf(Promise);

    store.clearMemory(); // both handles idle, promises undefined

    expect(together.promise).toBeUndefined();
  });
});

// =============================================================================
// findDocumentsTogether — reactivity
// =============================================================================

describe("store.findDocumentsTogether — reactive reads", () => {
  it("re-runs a `status` subscriber when the batch finishes loading", async () => {
    const together = store.findDocumentsTogether("user", ["1", "2"]);

    const seen: Array<string> = [];
    effect(() => {
      seen.push(together.status);
    });
    expect(seen).toEqual(["pending"]);

    await flushCoalescer();

    expect(seen.at(-1)).toBe("success");
  });

  it("does NOT re-run a `status` subscriber when one id loads but others are still pending", () => {
    const together = store.findDocumentsTogether("user", ["1", "2"]);

    const seen: Array<string> = [];
    effect(() => {
      seen.push(together.status);
    });
    expect(seen).toEqual(["pending"]);

    // Commit id 1 while id 2 is still in flight: the batch is still "pending",
    // so the computed's cut-off keeps the subscriber quiet.
    store.insertDocument("user", makeUser("1"));
    expect(seen).toEqual(["pending"]);
  });
});
