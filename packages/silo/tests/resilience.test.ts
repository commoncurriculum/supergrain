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

describe("store.resolveAdapterOptions", () => {
  it("falls back to the built-in defaultRetry (timeout/deadline off) when unset", () => {
    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: () => Effect.succeed([]) } } },
    });
    const resolved = store.resolveAdapterOptions();
    expect(resolved.retry).toBe(defaultRetry);
    expect(resolved.timeout).toBeUndefined();
    expect(resolved.deadline).toBeUndefined();
  });

  it("uses store-wide retry/timeout/deadline when set", () => {
    const retry = Schedule.recurs(2);
    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: () => Effect.succeed([]) } } },
      retry,
      timeout: "5 seconds",
      deadline: "30 seconds",
    });
    const resolved = store.resolveAdapterOptions();
    expect(resolved.retry).toBe(retry);
    expect(resolved.timeout).toBe("5 seconds");
    expect(resolved.deadline).toBe("30 seconds");
  });

  it("merges per-call overrides over the store-wide defaults", () => {
    const storeRetry = Schedule.recurs(2);
    const callRetry = Schedule.recurs(7);
    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: () => Effect.succeed([]) } } },
      retry: storeRetry,
      timeout: "5 seconds",
    });
    const resolved = store.resolveAdapterOptions({ retry: callRetry, deadline: "1 second" });
    expect(resolved.retry).toBe(callRetry); // overridden
    expect(resolved.timeout).toBe("5 seconds"); // inherited
    expect(resolved.deadline).toBe("1 second"); // newly set per-call
  });
});

describe("default retry", () => {
  it("applies the built-in (jittered) fibonacci default to a fetch with no retry configured", async () => {
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
      // no retry / timeout => the built-in jittered fibonacci default applies
    });

    const handle = store.find("user", "1");
    // First fibonacci delay is 1s, jittered up to ~1.2s; advance well past it.
    await vi.advanceTimersByTimeAsync(2000);
    await handle.promise?.catch(() => {});

    expect(calls).toBe(2);
    expect(handle.value).toEqual(doc);
    expect(handle.status).toBe("success");
  });
});

describe("failure visibility during retry", () => {
  it("fires onError per failed attempt and tracks failureCount/lastError to terminal", async () => {
    let calls = 0;
    const seen: Array<string> = [];
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () =>
              Effect.suspend(() => {
                calls += 1;
                return Effect.fail(
                  new AdapterError({ type: "user", keys: ["1"], cause: `fail-${calls}` }),
                );
              }),
          },
          retry: Schedule.recurs(2), // 3 attempts, all fail
        },
      },
      onError: (error) => seen.push(error._tag),
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(calls).toBe(3);
    // onError fires once per failed attempt, not only on exhaustion.
    expect(seen).toEqual(["AdapterError", "AdapterError", "AdapterError"]);
    expect(handle.failureCount).toBe(3);
    expect(handle.lastError).toBeInstanceOf(AdapterError);
    expect(handle.error).toBeInstanceOf(AdapterError);
    expect(handle.status).toBe("error");
  });

  it("resets failureCount/lastError once a recovering retry succeeds", async () => {
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
          retry: Schedule.recurs(3),
        },
      },
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(handle.value).toEqual(doc);
    expect(handle.failureCount).toBe(0);
    expect(handle.lastError).toBeUndefined();
    expect(handle.error).toBeUndefined();
    expect(handle.status).toBe("success");
  });
});

describe("retryable errors", () => {
  it("does not retry an AdapterError marked retryable: false", async () => {
    let calls = 0;
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () =>
              Effect.suspend(() => {
                calls += 1;
                return Effect.fail(
                  new AdapterError({
                    type: "user",
                    keys: ["1"],
                    cause: "hard 4xx",
                    retryable: false,
                  }),
                );
              }),
          },
          retry: Schedule.recurs(5), // would retry, but the error opts out
        },
      },
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(calls).toBe(1); // failed fast, no retries
    expect(handle.error).toBeInstanceOf(AdapterError);
    expect(handle.status).toBe("error");
  });
});

describe("overall deadline", () => {
  it("fails with a 'deadline' AdapterError when retries exceed the budget", async () => {
    let calls = 0;
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () =>
              Effect.suspend(() => {
                calls += 1;
                return Effect.fail(new AdapterError({ type: "user", keys: ["1"], cause: "fail" }));
              }),
          },
          retry: Schedule.spaced("20 millis"), // would retry forever
          deadline: "70 millis", // ...but the overall budget caps it
        },
      },
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(handle.error).toBeInstanceOf(AdapterError);
    expect(((handle.error as AdapterError).cause as Error).message).toMatch(/deadline/i);
    expect((handle.error as AdapterError).retryable).toBe(false);
    expect(handle.status).toBe("error");
    expect(calls).toBeGreaterThan(1); // retried a few times before the budget elapsed
  });
});
