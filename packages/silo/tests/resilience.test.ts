// =============================================================================
// tests/resilience.test.ts
// =============================================================================
//
// Covers ModelConfig / QueryConfig `retry` and `timeout` — the Effect-native
// resilience the finder wraps around the adapter Effect (`adapterEffect` in
// src/finder.ts). Driven through a real `DocumentStore`, flushing the batch
// window with fake timers exactly like finder.test.ts.
// =============================================================================

import { Effect, Schedule } from "effect";
import { describe, expect, it, vi } from "vitest";

import { AdapterError, createDocumentStore, defaultRetry } from "../src";
import { setupFakeTimers } from "./setup/timers";

type Types = { user: { id: string; name: string } };
type Queries = { search: { params: { q: string }; result: { total: number } } };

setupFakeTimers();

/**
 * Flush the finder's batch window and let the (real-time) adapter Effects
 * settle. `retry`/`timeout` resolve on the Effect runtime's own clock, so we
 * run timers and microtasks until the handle stops fetching.
 */
async function settle(handle: { isFetching: boolean }): Promise<void> {
  for (let i = 0; i < 50 && (i === 0 || handle.isFetching); i++) {
    await vi.advanceTimersByTimeAsync(20);
  }
}

describe("ModelConfig.retry", () => {
  it("retries the adapter the scheduled number of times then succeeds", async () => {
    let calls = 0;
    const doc = { id: "1", name: "User1" };
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () =>
              Effect.suspend(() => {
                calls += 1;
                return calls <= 2
                  ? Effect.fail(new AdapterError({ type: "user", keys: ["1"], cause: "fail" }))
                  : Effect.succeed([doc]);
              }),
          },
          retry: Schedule.recurs(2), // up to 2 retries => 3 attempts total
        },
      },
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(calls).toBe(3);
    expect(handle.value).toEqual(doc);
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("success");
  });
});

describe("ModelConfig.timeout", () => {
  it("turns a hung adapter into an AdapterError mentioning 'timed out'", async () => {
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: { find: () => Effect.never },
          timeout: "10 millis",
        },
      },
      retry: Schedule.recurs(0), // a timeout should surface, not retry forever
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(handle.value).toBeUndefined();
    expect(handle.error).toBeInstanceOf(AdapterError);
    // The timeout reason is carried on the AdapterError's `cause`.
    expect(((handle.error as AdapterError).cause as Error).message).toMatch(/timed out/i);
    expect(handle.status).toBe("error");
  });
});

describe("QueryConfig.retry / timeout", () => {
  it("retries a failing query adapter then succeeds", async () => {
    let calls = 0;
    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: () => Effect.succeed([]) } } },
      queries: {
        search: {
          adapter: {
            find: () =>
              Effect.suspend(() => {
                calls += 1;
                return calls <= 1
                  ? Effect.fail(new AdapterError({ type: "search", keys: ["q"], cause: "fail" }))
                  : Effect.succeed([{ total: 7 }]);
              }),
          },
          retry: Schedule.recurs(1),
        },
      },
    });

    const handle = store.findQuery("search", { q: "hi" });
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(calls).toBe(2);
    expect(handle.value).toEqual({ total: 7 });
    expect(handle.status).toBe("success");
  });

  it("times out a hung query adapter into an AdapterError", async () => {
    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: () => Effect.succeed([]) } } },
      queries: {
        search: {
          adapter: { find: () => Effect.never },
          timeout: "10 millis",
        },
      },
      retry: Schedule.recurs(0), // a timeout should surface, not retry forever
    });

    const handle = store.findQuery("search", { q: "hi" });
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(handle.error).toBeInstanceOf(AdapterError);
    expect(((handle.error as AdapterError).cause as Error).message).toMatch(/timed out/i);
    expect(handle.status).toBe("error");
  });
});

describe("runAdapter — per-attempt signal", () => {
  it("hands each retry attempt a fresh, non-aborted AbortSignal", async () => {
    let calls = 0;
    const abortedAtCall: Array<boolean> = [];
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: (_ids, ctx) =>
              Effect.suspend(() => {
                calls += 1;
                abortedAtCall.push(ctx?.signal?.aborted ?? true);
                return calls <= 2
                  ? Effect.fail(new AdapterError({ type: "user", keys: ["1"], cause: "fail" }))
                  : Effect.succeed([{ id: "1", name: "User1" }]);
              }),
          },
          retry: Schedule.recurs(2),
        },
      },
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    // A fresh AbortController per attempt ⇒ no attempt sees an already-aborted signal.
    expect(abortedAtCall).toEqual([false, false, false]);
    expect(handle.value).toEqual({ id: "1", name: "User1" });
  });
});

describe("config.onError", () => {
  it("fires with the AdapterError (and failing keys) when the adapter fails", async () => {
    const seen: Array<{ tag: string; keys: ReadonlyArray<string> }> = [];
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () => Effect.fail(new AdapterError({ type: "user", keys: ["1"], cause: "x" })),
          },
        },
      },
      retry: Schedule.recurs(0),
      onError: (error, ctx) => seen.push({ tag: error._tag, keys: ctx.keys }),
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(seen).toContainEqual({ tag: "AdapterError", keys: ["1"] });
  });

  it("fires a NotFoundError when the key is absent after a successful fetch", async () => {
    const tags: Array<string> = [];
    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: () => Effect.succeed([]) } } },
      onError: (error) => tags.push(error._tag),
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(tags).toContain("NotFoundError");
  });

  it("a throwing onError never breaks the store", async () => {
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () => Effect.fail(new AdapterError({ type: "user", keys: ["1"], cause: "x" })),
          },
        },
      },
      retry: Schedule.recurs(0),
      onError: () => {
        throw new Error("telemetry boom");
      },
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    // The store still settles the handle despite the throwing sink.
    expect(handle.error).toBeInstanceOf(AdapterError);
    expect(handle.status).toBe("error");
  });
});

describe("default retry", () => {
  it("exposes the built-in defaultRetry on store.defaults when unset", () => {
    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: () => Effect.succeed([]) } } },
    });
    expect(store.defaults.retry).toBe(defaultRetry);
    expect(store.defaults.timeout).toBeUndefined();
  });

  it("exposes a store-wide retry/timeout override on store.defaults", () => {
    const retry = Schedule.recurs(2);
    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: () => Effect.succeed([]) } } },
      retry,
      timeout: "5 seconds",
    });
    expect(store.defaults.retry).toBe(retry);
    expect(store.defaults.timeout).toBe("5 seconds");
  });

  it("applies the built-in fibonacci default to a fetch with no retry configured", async () => {
    let calls = 0;
    const doc = { id: "1", name: "User1" };
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () =>
              Effect.suspend(() => {
                calls += 1;
                return calls <= 1
                  ? Effect.fail(new AdapterError({ type: "user", keys: ["1"], cause: "fail" }))
                  : Effect.succeed([doc]);
              }),
          },
        },
      },
      // no retry / timeout => the built-in fibonacci default applies
    });

    const handle = store.find("user", "1");
    // First fibonacci delay is 1s; advance past it so the retry fires.
    await vi.advanceTimersByTimeAsync(1100);
    await handle.promise?.catch(() => {});

    expect(calls).toBe(2);
    expect(handle.value).toEqual(doc);
    expect(handle.status).toBe("success");
  });
});
