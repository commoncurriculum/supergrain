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

import { AdapterError, createDocumentStore, defaultRetry, runAdapter } from "../src";
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
    // The timeout is tagged structurally (and still carried on `cause`).
    expect((handle.error as AdapterError).reason).toBe("timeout");
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
    expect((handle.error as AdapterError).reason).toBe("deadline");
    expect(((handle.error as AdapterError).cause as Error).message).toMatch(/deadline/i);
    expect((handle.error as AdapterError).retryable).toBe(false);
    expect(handle.status).toBe("error");
    expect(calls).toBeGreaterThan(1); // retried a few times before the budget elapsed
  });
});

describe("retryable classifier", () => {
  it("vetoes retries for a failure the classifier deems terminal", async () => {
    let calls = 0;
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () =>
              Effect.suspend(() => {
                calls += 1;
                // Stand-in for a coerced Promise rejection: the cause carries a
                // 4xx status the adapter never marked non-retryable itself.
                return Effect.fail(
                  new AdapterError({ type: "user", keys: ["1"], cause: { status: 404 } }),
                );
              }),
          },
          retry: Schedule.recurs(5), // would retry, but the classifier vetoes
          retryable: (error) => ((error.cause as { status?: number }).status ?? 0) >= 500,
        },
      },
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(calls).toBe(1); // classifier deemed 404 terminal — no retries
    expect(handle.error).toBeInstanceOf(AdapterError);
    expect(handle.status).toBe("error");
  });

  it("keeps retrying when the classifier deems the failure transient", async () => {
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
                  ? Effect.fail(
                      new AdapterError({ type: "user", keys: ["1"], cause: { status: 503 } }),
                    )
                  : Effect.succeed([doc]);
              }),
          },
          retry: Schedule.recurs(5),
          retryable: (error) => ((error.cause as { status?: number }).status ?? 0) >= 500,
        },
      },
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(calls).toBe(3); // 5xx is transient — retried to success
    expect(handle.value).toEqual(doc);
    expect(handle.status).toBe("success");
  });
});

describe("a throwing onError never breaks the store across retries", () => {
  it("isolates a sink that throws on every failed attempt", async () => {
    let calls = 0;
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () =>
              Effect.suspend(() => {
                calls += 1;
                return Effect.fail(new AdapterError({ type: "user", keys: ["1"], cause: "x" }));
              }),
          },
          retry: Schedule.recurs(2), // 3 attempts, each fires the throwing sink
        },
      },
      onError: () => {
        throw new Error("telemetry boom");
      },
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    // Every attempt ran and the handle settled despite the per-attempt throw.
    expect(calls).toBe(3);
    expect(handle.failureCount).toBe(3);
    expect(handle.error).toBeInstanceOf(AdapterError);
    expect(handle.status).toBe("error");
  });
});

describe("onError context (attempt / retryable)", () => {
  it("reports the 1-based attempt and retryability of each failure", async () => {
    const seen: Array<{ attempt: number; retryable: boolean }> = [];
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () => Effect.fail(new AdapterError({ type: "user", keys: ["1"], cause: "x" })),
          },
          retry: Schedule.recurs(2), // 3 attempts
        },
      },
      onError: (_error, ctx) => seen.push({ attempt: ctx.attempt, retryable: ctx.retryable }),
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    // Plain AdapterError (no `retryable: false`, no classifier) is retryable on
    // every attempt — the schedule, not the error, ends the loop.
    expect(seen).toEqual([
      { attempt: 1, retryable: true },
      { attempt: 2, retryable: true },
      { attempt: 3, retryable: true },
    ]);
  });

  it("reports retryable: false for a hard failure", async () => {
    const seen: Array<{ attempt: number; retryable: boolean }> = [];
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: () =>
              Effect.fail(
                new AdapterError({ type: "user", keys: ["1"], cause: "x", retryable: false }),
              ),
          },
          retry: Schedule.recurs(5),
        },
      },
      onError: (_error, ctx) => seen.push({ attempt: ctx.attempt, retryable: ctx.retryable }),
    });

    const handle = store.find("user", "1");
    await settle(handle);
    await handle.promise?.catch(() => {});

    expect(seen).toEqual([{ attempt: 1, retryable: false }]);
  });
});

describe("isolateFailures (bisect)", () => {
  it("isolates a poison id so its healthy neighbors still load", async () => {
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            // A bulk endpoint that fails the whole call if the poison id is in it.
            find: (ids) =>
              Effect.suspend(() =>
                ids.includes("bad")
                  ? Effect.fail(new AdapterError({ type: "user", keys: ids, cause: "poison" }))
                  : Effect.succeed(ids.map((id) => ({ id, name: `User${id}` }))),
              ),
          },
          retry: Schedule.recurs(0), // fail the full chunk once, then bisect
          isolateFailures: true,
        },
      },
    });

    const h1 = store.find("user", "1");
    const h2 = store.find("user", "2");
    const hBad = store.find("user", "bad");
    const h3 = store.find("user", "3");
    await settle(hBad);
    await hBad.promise?.catch(() => {});

    // The poison id is isolated; its batch-mates load fine.
    expect(h1.value).toEqual({ id: "1", name: "User1" });
    expect(h2.value).toEqual({ id: "2", name: "User2" });
    expect(h3.value).toEqual({ id: "3", name: "User3" });
    expect(hBad.error).toBeInstanceOf(AdapterError);
    expect(hBad.status).toBe("error");
    // Healthy handles recovered cleanly (the full-chunk failure reset on success).
    expect(h1.failureCount).toBe(0);
    expect(h1.error).toBeUndefined();
  });

  it("fails the whole chunk (no bisect) by default", async () => {
    const store = createDocumentStore<Types, Queries>({
      models: {
        user: {
          adapter: {
            find: (ids) =>
              Effect.suspend(() =>
                ids.includes("bad")
                  ? Effect.fail(new AdapterError({ type: "user", keys: ids, cause: "poison" }))
                  : Effect.succeed(ids.map((id) => ({ id, name: `User${id}` }))),
              ),
          },
          retry: Schedule.recurs(0),
          // isolateFailures omitted → whole chunk fails together
        },
      },
    });

    const h1 = store.find("user", "1");
    const hBad = store.find("user", "bad");
    await settle(hBad);
    await hBad.promise?.catch(() => {});

    expect(h1.error).toBeInstanceOf(AdapterError); // healthy id dragged down
    expect(hBad.error).toBeInstanceOf(AdapterError);
  });
});

describe("maxConcurrency", () => {
  type T = { user: { id: string; name: string } };

  function makeStore(maxConcurrency: number | "unbounded", track: { active: number; max: number }) {
    return createDocumentStore<T>({
      models: {
        user: {
          adapter: {
            find: (ids) =>
              Effect.gen(function* () {
                track.active += 1;
                track.max = Math.max(track.max, track.active);
                yield* Effect.sleep("10 millis");
                track.active -= 1;
                return ids.map((id) => ({ id, name: `User${id}` }));
              }),
          },
        },
      },
      batchSize: 1, // one chunk per id
      maxConcurrency,
      retry: Schedule.recurs(0),
    });
  }

  it("caps simultaneous adapter calls", async () => {
    const track = { active: 0, max: 0 };
    const store = makeStore(1, track);
    store.find("user", "1");
    store.find("user", "2");
    const h3 = store.find("user", "3");
    await settle(h3);
    expect(track.max).toBe(1);
  });

  it("fans out unbounded by default", async () => {
    const track = { active: 0, max: 0 };
    const store = makeStore("unbounded", track);
    store.find("user", "1");
    store.find("user", "2");
    const h3 = store.find("user", "3");
    await settle(h3);
    expect(track.max).toBe(3);
  });
});

describe("query param cache keys (stableStringify)", () => {
  type T = { doc: { id: string } };
  type NumQ = { metric: { params: { v: number }; result: { ok: boolean } } };

  const makeStore = () =>
    createDocumentStore<T, NumQ>({
      models: { doc: { adapter: { find: () => Effect.succeed([]) } } },
      queries: { metric: { adapter: { find: () => Effect.succeed([]) } } },
      retry: Schedule.recurs(0),
    });

  it("keeps NaN / Infinity / -Infinity / null on distinct cache slots", () => {
    const store = makeStore();
    const handles = new Set([
      store.findQuery("metric", { v: NaN }),
      store.findQuery("metric", { v: Infinity }),
      store.findQuery("metric", { v: -Infinity }),
      store.findQuery("metric", { v: null as unknown as number }),
    ]);
    expect(handles.size).toBe(4);
  });

  it("throws a clear error on cyclic params instead of overflowing the stack", () => {
    const store = makeStore();
    const cyclic: { v: number; self?: unknown } = { v: 1 };
    cyclic.self = cyclic;
    expect(() => store.findQuery("metric", cyclic as unknown as { v: number })).toThrow(/acyclic/);
  });
});

describe("isolateFailures (query bisect)", () => {
  it("isolates a poison query so its healthy batch-mate still loads", async () => {
    const store = createDocumentStore<Types, Queries>({
      models: { user: { adapter: { find: () => Effect.succeed([]) } } },
      queries: {
        search: {
          adapter: {
            // Bulk query endpoint that fails the whole call if the poison is present.
            find: (paramsList) =>
              Effect.suspend(() =>
                (paramsList as Array<{ q: string }>).some((p) => p.q === "bad")
                  ? Effect.fail(new AdapterError({ type: "search", keys: [], cause: "poison" }))
                  : Effect.succeed(
                      (paramsList as Array<{ q: string }>).map((p) => ({ total: p.q.length })),
                    ),
              ),
          },
          retry: Schedule.recurs(0),
          isolateFailures: true,
        },
      },
    });

    const ok = store.findQuery("search", { q: "ok" });
    const bad = store.findQuery("search", { q: "bad" });
    await settle(bad);
    await bad.promise?.catch(() => {});

    expect(ok.value).toEqual({ total: 2 }); // "ok".length
    expect(ok.status).toBe("success");
    expect(bad.error).toBeInstanceOf(AdapterError);
    expect(bad.status).toBe("error");
  });
});

describe("query param cache keys — exotic value types", () => {
  type T = { doc: { id: string } };
  type NumQ = { metric: { params: { v: number }; result: { ok: boolean } } };

  const makeStore = () =>
    createDocumentStore<T, NumQ>({
      models: { doc: { adapter: { find: () => Effect.succeed([]) } } },
      queries: { metric: { adapter: { find: () => Effect.succeed([]) } } },
      retry: Schedule.recurs(0),
    });

  it("encodes bigint / nested-undefined / symbol / function params without collision or throw", () => {
    const store = makeStore();
    const handles = new Set([
      store.findQuery("metric", { v: 1n as unknown as number }), // bigint
      store.findQuery("metric", { a: undefined } as unknown as { v: number }), // nested undefined
      store.findQuery("metric", { v: Symbol("x") as unknown as number }), // symbol → String() fallback
      store.findQuery("metric", { v: (() => 0) as unknown as number }), // function → String() fallback
    ]);
    expect(handles.size).toBe(4);
  });
});

describe("runAdapter without an onFailure sink", () => {
  it("fails without reporting when no sink (and no retry) is supplied", async () => {
    // No `retry` → exercises the unretried path; no `onFailure` → unreported.
    const program = runAdapter(
      () => Effect.fail(new AdapterError({ type: "u", keys: ["1"], cause: "x" })),
      { type: "u", keys: ["1"] },
    );
    const exit = await Effect.runPromiseExit(program);
    expect(exit._tag).toBe("Failure");
  });

  it("breaches a deadline without reporting when no sink is supplied", async () => {
    const program = runAdapter(() => Effect.never, {
      type: "u",
      keys: ["1"],
      retry: Schedule.recurs(0),
      deadline: "10 millis",
    });
    const exitPromise = Effect.runPromiseExit(program);
    await vi.advanceTimersByTimeAsync(20);
    const exit = await exitPromise;
    expect(exit._tag).toBe("Failure");
  });
});
