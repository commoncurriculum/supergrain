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
// store.findAll — the batched, multi-id aggregate over store.find.
//
// findAll(type, ids) maps each id through store.find (stable + idempotent) and
// wraps the resulting handles in a DocumentHandles aggregate. These tests cover
// the aggregate's fields (handles / values / status / statusStrict / promise /
// promiseStrict) across the pending → success/error transitions, plus the
// idle/empty edges and the reactive read contract.
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
// Idle + empty edges
// =============================================================================

describe("store.findAll — idle (no ids)", () => {
  it("returns an idle aggregate for null ids, touching no network", async () => {
    const handles = store.findAll("user", null);

    expect(handles.handles).toEqual([]);
    expect(handles.values).toEqual([]);
    expect(handles.status).toBe("pending");
    expect(handles.statusStrict).toBe("pending");
    expect(handles.promise).toBeUndefined();
    expect(handles.promiseStrict).toBeUndefined();

    await flushCoalescer();
    expect(requests()).toEqual([]);
  });

  it("returns an idle aggregate for undefined ids", () => {
    const handles = store.findAll("user", undefined);

    expect(handles.handles).toEqual([]);
    expect(handles.status).toBe("pending");
    expect(handles.statusStrict).toBe("pending");
  });
});

describe("store.findAll — empty ids array", () => {
  it("is a successful aggregate with no values and no fetch", async () => {
    const handles = store.findAll("user", []);

    expect(handles.handles).toEqual([]);
    expect(handles.values).toEqual([]);
    expect(handles.status).toBe("success");
    expect(handles.statusStrict).toBe("success");

    await flushCoalescer();
    expect(requests()).toEqual([]);
  });

  it("its promise resolves to an empty array", async () => {
    const handles = store.findAll("user", []);

    await expect(handles.promise).resolves.toEqual([]);
    await expect(handles.promiseStrict).resolves.toEqual([]);
  });
});

// =============================================================================
// handles — order + stability
// =============================================================================

describe("store.findAll — handles", () => {
  it("collects one handle per id, in id order, each === store.find(id)", () => {
    const handles = store.findAll("user", ["1", "2", "3"]);

    expect(handles.handles).toHaveLength(3);
    // Idempotent: findAll's handles are the very objects store.find hands out.
    expect(handles.handles[0]).toBe(store.find("user", "1"));
    expect(handles.handles[1]).toBe(store.find("user", "2"));
    expect(handles.handles[2]).toBe(store.find("user", "3"));
  });

  it("returns a fresh aggregate each call, but the same inner handles", () => {
    const a = store.findAll("user", ["1", "2"]);
    const b = store.findAll("user", ["1", "2"]);

    // The wrapper is intentionally not stable (useDocuments layers that on top).
    expect(a).not.toBe(b);
    // The handles inside are stable — find is idempotent.
    expect(a.handles[0]).toBe(b.handles[0]);
    expect(a.handles[1]).toBe(b.handles[1]);
  });

  it("triggers a single batched fetch for all ids", async () => {
    store.findAll("user", ["1", "2", "3"]);

    await flushCoalescer();

    const userReqs = requests().filter((r) => r.url.pathname === "/users");
    expect(userReqs).toHaveLength(1);
    expect(userReqs[0].url.searchParams.getAll("id")).toEqual(["1", "2", "3"]);
  });
});

// =============================================================================
// values + status — pending → success
// =============================================================================

describe("store.findAll — values and status while loading", () => {
  it("starts pending with no values, then resolves to values in id order", async () => {
    const handles = store.findAll("user", ["1", "2", "3"]);

    expect(handles.status).toBe("pending");
    expect(handles.statusStrict).toBe("pending");
    expect(handles.values).toEqual([]);

    await flushCoalescer();

    expect(handles.status).toBe("success");
    expect(handles.statusStrict).toBe("success");
    expect(handles.values.map((u) => u.id)).toEqual(["1", "2", "3"]);
  });

  it("reads successful values from cache with no loading state", async () => {
    store.insertDocument("user", makeUser("1", { firstName: "Ada" }));
    store.insertDocument("user", makeUser("2", { firstName: "Grace" }));

    const handles = store.findAll("user", ["1", "2"]);

    expect(handles.status).toBe("success");
    expect(handles.values.map((u) => u.attributes.firstName)).toEqual(["Ada", "Grace"]);
    // Each cached handle carries a resolved promise, so the combined promise is
    // already fulfilled with the values (React 19 `use()` reads them synchronously).
    await expect(handles.promise).resolves.toHaveLength(2);
    await expect(handles.promiseStrict).resolves.toHaveLength(2);
  });

  it("caches the values array — same reference when the content is unchanged", async () => {
    const handles = store.findAll("user", ["1", "2"]);
    await flushCoalescer();

    const first = handles.values;
    // A second read with no underlying change returns the identical array.
    expect(handles.values).toBe(first);
  });
});

// =============================================================================
// Mixed success/error — the "strict" vs lenient aggregates diverge
// =============================================================================

describe("store.findAll — a partial failure", () => {
  it("omits the errored value from `values` but keeps id order", async () => {
    omitUserIds("2"); // id 2 → NotFoundError, 1 and 3 succeed

    const handles = store.findAll("user", ["1", "2", "3"]);
    await flushCoalescer();

    expect(handles.values.map((u) => u.id)).toEqual(["1", "3"]);
    // The errored handle is still present in `handles`, in position.
    expect(handles.handles[1].error).toBeInstanceOf(NotFoundError);
  });

  it("status stays `success` (lenient) while statusStrict is `error`", async () => {
    omitUserIds("2");

    const handles = store.findAll("user", ["1", "2", "3"]);
    await flushCoalescer();

    // Lenient status ignores the error — the non-errored values all succeeded.
    expect(handles.status).toBe("success");
    // Strict status treats any error as terminal.
    expect(handles.statusStrict).toBe("error");
  });
});

// =============================================================================
// promise / promiseStrict
// =============================================================================

describe("store.findAll — promise (lenient)", () => {
  it("resolves with only the successful values once nothing is pending", async () => {
    omitUserIds("2");

    const handles = store.findAll("user", ["1", "2", "3"]);
    const promise = handles.promise;
    expect(promise).toBeInstanceOf(Promise);

    await flushCoalescer();

    // allSettled semantics: never rejects, snapshots the successes in order.
    await expect(promise).resolves.toEqual([
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "3" }),
    ]);
  });

  it("returns a stable promise identity across reads while inputs are unchanged", () => {
    const handles = store.findAll("user", ["1", "2"]);

    // Same underlying handle.promise references → same combined promise.
    expect(handles.promise).toBe(handles.promise);
  });
});

describe("store.findAll — promiseStrict", () => {
  it("resolves with every value when all ids succeed", async () => {
    const handles = store.findAll("user", ["1", "2"]);
    const promise = handles.promiseStrict;

    await flushCoalescer();

    await expect(promise).resolves.toEqual([
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2" }),
    ]);
  });

  it("rejects when any id errors", async () => {
    omitUserIds("2");

    const handles = store.findAll("user", ["1", "2", "3"]);
    const promise = handles.promiseStrict;

    await flushCoalescer();

    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns a stable promise identity across reads while inputs are unchanged", () => {
    const handles = store.findAll("user", ["1", "2"]);

    expect(handles.promiseStrict).toBe(handles.promiseStrict);
  });
});

// =============================================================================
// Reactivity — the aggregate's getters read the live handles, so a subscriber
// re-fires when a fetch settles (findAll itself is not wrapped in effect()).
// =============================================================================

describe("store.findAll — reactive reads", () => {
  it("re-runs a `values` subscriber when the fetch resolves", async () => {
    const handles = store.findAll("user", ["1", "2"]);

    const seen: Array<Array<string>> = [];
    effect(() => {
      seen.push(handles.values.map((u) => u.id));
    });
    // First run: still pending, no values.
    expect(seen).toEqual([[]]);

    await flushCoalescer();

    // The effect re-ran once the underlying handles committed their values.
    expect(seen.at(-1)).toEqual(["1", "2"]);
  });

  it("re-runs a `status` subscriber when the fetch resolves", async () => {
    const handles = store.findAll("user", ["1", "2"]);

    const seen: Array<string> = [];
    effect(() => {
      seen.push(handles.status);
    });
    expect(seen).toEqual(["pending"]);

    await flushCoalescer();

    expect(seen.at(-1)).toBe("success");
  });
});
