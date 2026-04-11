import type { DocumentAdapter, DocumentResponse } from "../src";
import type { User } from "./helpers";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { advance, flushCoalescer, makeStore } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// Coalescer — basic dedup + batch
// =============================================================================

describe("coalescer batching", () => {
  it("dedupes concurrent calls within the batch window into a single adapter call", async () => {
    const { store, userAdapter } = makeStore();

    store.findDoc("user", "1");
    store.findDoc("user", "1");
    store.findDoc("user", "1");

    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
    expect(userAdapter.find).toHaveBeenCalledWith(["1"]);
  });

  it("batches multiple ids of the same type into one adapter call", async () => {
    const { store, userAdapter } = makeStore();

    store.findDoc("user", "1");
    store.findDoc("user", "2");
    store.findDoc("user", "3");

    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
    const ids = (userAdapter.find as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ids).toEqual(expect.arrayContaining(["1", "2", "3"]));
    expect(ids).toHaveLength(3);
  });

  it("starts a fresh batch window after the previous one drains", async () => {
    const { store, userAdapter } = makeStore();

    store.findDoc("user", "1");
    store.findDoc("user", "2");
    await flushCoalescer();
    expect(userAdapter.find).toHaveBeenCalledTimes(1);

    // New calls after the window has drained start a new batch
    store.findDoc("user", "3");
    store.findDoc("user", "4");
    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(2);
    const secondCallIds = (userAdapter.find as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as string[];
    expect(secondCallIds).toEqual(expect.arrayContaining(["3", "4"]));
  });
});

// =============================================================================
// Coalescer — in-flight dedup across tick boundaries
// =============================================================================

describe("coalescer in-flight dedup", () => {
  it("reuses an in-flight fetch for a later findDoc call spanning tick boundaries", async () => {
    // Delay the adapter response so we can observe an "in-flight" state
    // that spans two coalescer ticks.
    let resolveFirst: (() => void) | undefined;
    const findSpy = vi.fn(
      (ids: string[]): Promise<DocumentResponse<User>> =>
        new Promise((resolve) => {
          resolveFirst = () =>
            resolve({
              data: ids.map((id) => ({
                type: "user",
                id,
                attributes: {
                  firstName: `User${id}`,
                  lastName: "X",
                  email: "x@y",
                },
                meta: { revision: 1 },
              })),
            });
        }),
    );
    const userAdapter: DocumentAdapter<User> = { find: findSpy };
    const { store } = makeStore({
      adapters: {
        user: userAdapter,
        post: { find: async () => ({ data: [] }) },
      },
    });

    // First findDoc triggers the batch window; fetch is dispatched but
    // not yet resolved.
    store.findDoc("user", "1");
    await advance(20); // past the batch window, fetch is in flight
    expect(findSpy).toHaveBeenCalledTimes(1);

    // A second findDoc during the in-flight period must NOT dispatch
    // a new fetch — it should attach to the existing work.
    store.findDoc("user", "1");
    await advance(20);

    expect(findSpy).toHaveBeenCalledTimes(1);

    // Resolve the first fetch
    resolveFirst!();
    await vi.runAllTimersAsync();

    expect(findSpy).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Coalescer — batch size chunking
// =============================================================================

describe("coalescer batch size chunking", () => {
  it("chunks a large batch into multiple adapter calls capped at batchSize", async () => {
    const { store, userAdapter } = makeStore({ batchSize: 3 });

    // 8 ids with batchSize=3 → expect 3 adapter calls (3 + 3 + 2)
    for (let i = 1; i <= 8; i++) {
      store.findDoc("user", String(i));
    }

    await flushCoalescer();

    expect(userAdapter.find).toHaveBeenCalledTimes(3);
    const callArgs = (userAdapter.find as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string[],
    );
    const allIds = callArgs.flat().sort();
    expect(allIds).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);

    const chunkSizes = callArgs.map((c) => c.length).sort();
    expect(chunkSizes).toEqual([2, 3, 3]);
  });
});
