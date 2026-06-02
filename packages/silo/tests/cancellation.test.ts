// =============================================================================
// tests/cancellation.test.ts
// =============================================================================
//
// Subscriber-gated cancellation. The store ref-counts subscribers per key
// (the React hooks call subscribeDocument/subscribeQuery on mount, the returned
// cleanup on unmount). When the last subscriber for every key in an in-flight
// chunk goes away, the chunk's fiber is interrupted — aborting the request's
// AbortSignal — and its handles reset to idle so a later find refetches.
//
// Driven through a real DocumentStore with fake timers (the batch window runs
// on Effect.sleep; the gc deferral on setTimeout — both advance together).
// =============================================================================

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createDocumentStore, type DocumentAdapter } from "../src";
import { Finder, type InternalState } from "../src/finder";
import { makeIdleHandle } from "../src/transitions";
import { setupFakeTimers } from "./setup/timers";

type Types = { user: { id: string; name: string } };
type MultiTypes = Types & { post: { id: string; title: string } };

setupFakeTimers();

interface Controllable {
  adapter: DocumentAdapter;
  calls: ReadonlyArray<ReadonlyArray<string>>;
  /** The signal handed to the most recent `find` call. */
  readonly signal: AbortSignal | undefined;
  /** Resolve the most recent in-flight request. */
  resolve(): void;
  /** Whether the adapter threaded the signal into its request (default true). */
}

/**
 * A Promise adapter whose request stays pending until `resolve()`, and which —
 * by default — honors the abort signal (rejecting on abort). Pass
 * `honorSignal: false` to model an adapter that ignores the signal.
 */
function controllable(
  honorSignal = true,
  makeDoc: (id: string) => unknown = (id) => ({ id, name: `User${id}` }),
): Controllable {
  const calls: Array<Array<string>> = [];
  let signal: AbortSignal | undefined;
  let resolveCurrent: (() => void) | undefined;

  const adapter: DocumentAdapter = {
    find: (ids, ctx) => {
      calls.push([...ids]);
      signal = ctx?.signal;
      return new Promise<Array<unknown>>((resolve, reject) => {
        resolveCurrent = () => resolve(ids.map(makeDoc));
        if (honorSignal && ctx?.signal) {
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
      });
    },
  };

  return {
    adapter,
    calls,
    get signal() {
      return signal;
    },
    resolve() {
      resolveCurrent?.();
    },
  };
}

async function tick(ms = 20): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("subscriber-gated cancellation", () => {
  it("interrupts an in-flight fetch and aborts the wire when the last subscriber leaves", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    const handle = store.find("user", "1");
    const unsub = store.subscribeDocument("user", "1");
    await tick(); // window elapses → chunk fiber forked → request in flight

    expect(c.calls).toEqual([["1"]]);
    expect(handle.isFetching).toBe(true);
    expect(c.signal?.aborted).toBe(false);

    unsub(); // last subscriber gone
    await tick(); // gc(0) fires next tick → interrupt → AbortController.abort()

    expect(c.signal?.aborted).toBe(true);
    // Handle reset to idle so renewed interest refetches.
    expect(handle.isFetching).toBe(false);
    expect(handle.status).toBe("pending");
    expect(handle.value).toBeUndefined();
  });

  it("keeps the fetch while any key in the batch still has a subscriber", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    store.find("user", "1");
    store.find("user", "2"); // same window → one chunk ["1","2"]
    const unsub1 = store.subscribeDocument("user", "1");
    const unsub2 = store.subscribeDocument("user", "2");
    await tick();
    expect(c.calls).toEqual([["1", "2"]]);

    unsub2();
    await tick();
    expect(c.signal?.aborted).toBe(false); // "1" still subscribed → chunk kept

    unsub1();
    await tick();
    expect(c.signal?.aborted).toBe(true); // both abandoned → interrupted
  });

  it("a re-subscribe before the next tick cancels the pending interrupt", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    store.find("user", "1");
    const unsub = store.subscribeDocument("user", "1");
    await tick();

    unsub();
    const unsubAgain = store.subscribeDocument("user", "1"); // synchronous re-subscribe
    await tick();

    expect(c.signal?.aborted).toBe(false); // interrupt cancelled
    expect(c.calls).toEqual([["1"]]); // no refetch

    unsubAgain();
  });

  it("refetches when interest returns after a gc interrupt", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    store.find("user", "1");
    const unsub = store.subscribeDocument("user", "1");
    await tick();
    unsub();
    await tick();
    expect(c.signal?.aborted).toBe(true);

    // Interest returns: the handle is idle again, so find re-triggers a fetch.
    const handle = store.find("user", "1");
    const unsubAgain = store.subscribeDocument("user", "1");
    await tick();

    expect(c.calls).toEqual([["1"], ["1"]]);
    expect(handle.isFetching).toBe(true);
    unsubAgain();
  });

  it("discards a late result after interruption even when the adapter ignores the signal", async () => {
    const c = controllable(false); // adapter never honors the abort signal
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    const handle = store.find("user", "1");
    const unsub = store.subscribeDocument("user", "1");
    await tick();

    unsub();
    await tick(); // interrupt: fiber gone, even if the request later resolves

    c.resolve(); // the ignored request finally settles
    await tick();

    expect(handle.value).toBeUndefined(); // no stale write
    expect(handle.status).toBe("pending");
  });

  it("interrupts an Effect adapter natively, running its finalizer", async () => {
    let finalized = false;
    // An Effect adapter that hangs until interrupted, with a finalizer that
    // proves native interruption reached the adapter's own fiber.
    const adapter: DocumentAdapter = {
      find: () =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              finalized = true;
            }),
          ),
        ),
    };
    const store = createDocumentStore<Types>({ models: { user: { adapter } } });

    const handle = store.find("user", "1");
    const unsub = store.subscribeDocument("user", "1");
    await tick();
    expect(handle.isFetching).toBe(true);

    unsub();
    await tick();

    expect(finalized).toBe(true); // the adapter's own finalizer ran
    expect(handle.isFetching).toBe(false); // reset to idle
  });

  it("does not interrupt a fetch that was never subscribed", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    const handle = store.find("user", "1"); // no subscribeDocument
    await tick();
    await tick();

    expect(c.signal?.aborted).toBe(false);
    expect(handle.isFetching).toBe(true); // still in flight, untouched

    c.resolve();
    await tick();
    expect(handle.value).toEqual({ id: "1", name: "User1" });
  });

  it("keeps the fetch while a second subscriber on the same key remains", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    store.find("user", "1");
    const unsubA = store.subscribeDocument("user", "1");
    const unsubB = store.subscribeDocument("user", "1"); // count = 2
    await tick();

    unsubA(); // count = 1, still wanted
    await tick();
    expect(c.signal?.aborted).toBe(false);

    unsubB(); // count = 0
    await tick();
    expect(c.signal?.aborted).toBe(true);
  });

  it("interrupts only the abandoned chunk, leaving other in-flight types alone", async () => {
    const cUser = controllable();
    const cPost = controllable(true, (id) => ({ id, title: `Post${id}` }));
    const store = createDocumentStore<MultiTypes>({
      models: { user: { adapter: cUser.adapter }, post: { adapter: cPost.adapter } },
    });

    store.find("user", "1");
    store.find("post", "1"); // two separate chunks in flight
    const unsubUser = store.subscribeDocument("user", "1");
    const unsubPost = store.subscribeDocument("post", "1");
    await tick();

    unsubUser();
    await tick();

    expect(cUser.signal?.aborted).toBe(true); // abandoned chunk interrupted
    expect(cPost.signal?.aborted).toBe(false); // unrelated chunk untouched

    unsubPost();
    await tick();
  });
});

type QTypes = { search: { params: { q: string }; result: { id: string; type: "search" } } };

describe("query cancellation", () => {
  it("interrupts an in-flight query fetch when its last subscriber leaves", async () => {
    let signal: AbortSignal | undefined;
    const adapter = {
      find: (_paramsList: Array<{ q: string }>, ctx?: { signal: AbortSignal }) => {
        signal = ctx?.signal;
        return new Promise<Array<unknown>>((_resolve, reject) => {
          ctx?.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    };
    const store = createDocumentStore<Types, QTypes>({
      models: { user: { adapter: controllable().adapter } },
      queries: { search: { adapter } },
    });

    const handle = store.findQuery("search", { q: "x" });
    const unsub = store.subscribeQuery("search", { q: "x" });
    await tick();
    expect(handle.isFetching).toBe(true);
    expect(signal?.aborted).toBe(false);

    unsub();
    await tick();

    expect(signal?.aborted).toBe(true);
    expect(handle.isFetching).toBe(false);
    expect(handle.status).toBe("pending");
  });
});

describe("subscriber ref-counting (Finder unit)", () => {
  it("unsubscribe is a no-op for an unknown type, and is idempotent", () => {
    const finder = new Finder<Types>({ models: { user: { adapter: { find: async () => [] } } } });

    // Unknown type bucket → early return, no throw.
    expect(() => finder.unsubscribe("documents", "user", "nope")).not.toThrow();

    finder.subscribe("documents", "user", "1");
    finder.unsubscribe("documents", "user", "1"); // → 0, schedules gc
    // Second unsubscribe with a pending gc timer is a no-op.
    expect(() => finder.unsubscribe("documents", "user", "1")).not.toThrow();
  });

  it("an interrupt safely skips a handle evicted mid-flight", async () => {
    const c = controllable();
    const handle = makeIdleHandle();
    handle.isFetching = true;
    const state: InternalState = {
      documents: new Map([["user", new Map([["1", handle]])]]),
      queries: new Map(),
    };
    const host = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });
    const finder = new Finder<Types>({ models: { user: { adapter: c.adapter } } });
    finder.attach(state, host);

    finder.subscribe("documents", "user", "1");
    finder.queueDocument("user", "1");
    await tick(); // window → chunk in flight

    state.documents.get("user")!.delete("1"); // handle evicted before interrupt
    finder.unsubscribe("documents", "user", "1");
    await tick(); // gc → interrupt → resetKeys finds the bucket but no handle

    expect(c.signal?.aborted).toBe(true); // request still torn down, no throw
  });

  it("an interrupt safely no-ops when the type bucket was evicted mid-flight", async () => {
    const c = controllable();
    const handle = makeIdleHandle();
    handle.isFetching = true;
    const state: InternalState = {
      documents: new Map([["user", new Map([["1", handle]])]]),
      queries: new Map(),
    };
    const host = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });
    const finder = new Finder<Types>({ models: { user: { adapter: c.adapter } } });
    finder.attach(state, host);

    finder.subscribe("documents", "user", "1");
    finder.queueDocument("user", "1");
    await tick();

    state.documents.delete("user"); // whole bucket gone
    finder.unsubscribe("documents", "user", "1");
    await tick();

    expect(c.signal?.aborted).toBe(true);
  });
});
