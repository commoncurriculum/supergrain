import type { DocumentAdapter, DocumentResponse } from "../src";
import type { User } from "./helpers";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { flushCoalescer, makeStore } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// insertDocument — single
// =============================================================================

describe("insertDocument (single)", () => {
  it("populates the cache synchronously so the next findDoc is a hit", () => {
    const { store, userAdapter } = makeStore();

    store.insertDocument({
      type: "user",
      id: "1",
      attributes: {
        firstName: "Direct",
        lastName: "Write",
        email: "direct@example.com",
      },
    });

    const doc = store.findDoc("user", "1");
    expect(doc.status).toBe("success");
    expect(doc.data?.firstName).toBe("Direct");
    expect(userAdapter.find).not.toHaveBeenCalled();
  });

  it("updates existing handles reactively", async () => {
    const { store } = makeStore();
    const doc = store.findDoc("user", "1");
    await flushCoalescer();
    expect(doc.data?.firstName).toBe("User1");

    store.insertDocument({
      type: "user",
      id: "1",
      attributes: {
        firstName: "Updated",
        lastName: "U",
        email: "u@x.com",
      },
    });

    expect(doc.data?.firstName).toBe("Updated");
  });
});

// =============================================================================
// insertDocument — array form
// =============================================================================

describe("insertDocument (array)", () => {
  it("accepts an array and writes each doc reactively", () => {
    const { store, userAdapter, postAdapter } = makeStore();

    store.insertDocument([
      {
        type: "user",
        id: "1",
        attributes: { firstName: "A", lastName: "B", email: "a@b" },
      },
      {
        type: "post",
        id: "10",
        attributes: { title: "Hi", body: "b", authorId: "1" },
      },
    ]);

    const user = store.findDoc("user", "1");
    const post = store.findDoc("post", "10");

    expect(user.status).toBe("success");
    expect(user.data?.firstName).toBe("A");
    expect(post.status).toBe("success");
    expect(post.data?.title).toBe("Hi");
    expect(userAdapter.find).not.toHaveBeenCalled();
    expect(postAdapter.find).not.toHaveBeenCalled();
  });
});

// =============================================================================
// insertDocument — in-flight write policy
// =============================================================================

describe("insertDocument write policy vs in-flight fetch", () => {
  it("direct insert wins over a subsequently-arriving adapter response (no revision on either side)", async () => {
    // Adapter returns data WITHOUT a revision, so the policy falls back to
    // last-write-wins and the direct insert (which happens mid-flight) is
    // authoritative.
    let resolveFetch: (() => void) | undefined;
    const userFind = vi.fn(
      (ids: string[]): Promise<DocumentResponse<User>> =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({
              data: ids.map((id) => ({
                type: "user",
                id,
                attributes: {
                  firstName: "FromAdapter",
                  lastName: "X",
                  email: "x@y",
                },
                // no meta.revision
              })),
            });
        }),
    );
    const userAdapter: DocumentAdapter<User> = { find: userFind };
    const { store } = makeStore({
      adapters: {
        user: userAdapter,
        post: { find: async () => ({ data: [] }) },
      },
    });

    const doc = store.findDoc("user", "1");
    // Tick past batch window so the fetch is dispatched
    await vi.advanceTimersByTimeAsync(20);

    // Direct insert while the fetch is in flight
    store.insertDocument({
      type: "user",
      id: "1",
      attributes: {
        firstName: "DirectWins",
        lastName: "X",
        email: "x@y",
      },
    });
    expect(doc.data?.firstName).toBe("DirectWins");

    // Adapter response lands. Per policy (no revision on either side),
    // the direct insert stays authoritative.
    resolveFetch!();
    await vi.runAllTimersAsync();

    expect(doc.data?.firstName).toBe("DirectWins");
  });

  it("an in-flight response with a STRICTLY newer revision wins over a direct insert", async () => {
    let resolveFetch: (() => void) | undefined;
    const userFind = vi.fn(
      (ids: string[]): Promise<DocumentResponse<User>> =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({
              data: ids.map((id) => ({
                type: "user",
                id,
                attributes: {
                  firstName: "FromServer",
                  lastName: "X",
                  email: "x@y",
                },
                meta: { revision: 5 },
              })),
            });
        }),
    );
    const userAdapter: DocumentAdapter<User> = { find: userFind };
    const { store } = makeStore({
      adapters: {
        user: userAdapter,
        post: { find: async () => ({ data: [] }) },
      },
    });

    const doc = store.findDoc("user", "1");
    await vi.advanceTimersByTimeAsync(20);

    // Direct insert mid-flight with revision 2
    store.insertDocument({
      type: "user",
      id: "1",
      attributes: {
        firstName: "DirectInsert",
        lastName: "X",
        email: "x@y",
      },
      meta: { revision: 2 },
    });
    expect(doc.data?.firstName).toBe("DirectInsert");

    // Server response has revision 5 > 2, so it wins
    resolveFetch!();
    await vi.runAllTimersAsync();

    expect(doc.data?.firstName).toBe("FromServer");
    expect(doc.revision).toBe(5);
  });

  it("an in-flight response with an OLDER revision loses to a direct insert", async () => {
    let resolveFetch: (() => void) | undefined;
    const userFind = vi.fn(
      (ids: string[]): Promise<DocumentResponse<User>> =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({
              data: ids.map((id) => ({
                type: "user",
                id,
                attributes: {
                  firstName: "OldServer",
                  lastName: "X",
                  email: "x@y",
                },
                meta: { revision: 1 },
              })),
            });
        }),
    );
    const userAdapter: DocumentAdapter<User> = { find: userFind };
    const { store } = makeStore({
      adapters: {
        user: userAdapter,
        post: { find: async () => ({ data: [] }) },
      },
    });

    const doc = store.findDoc("user", "1");
    await vi.advanceTimersByTimeAsync(20);

    store.insertDocument({
      type: "user",
      id: "1",
      attributes: {
        firstName: "DirectNewer",
        lastName: "X",
        email: "x@y",
      },
      meta: { revision: 5 },
    });

    resolveFetch!();
    await vi.runAllTimersAsync();

    expect(doc.data?.firstName).toBe("DirectNewer");
    expect(doc.revision).toBe(5);
  });
});
