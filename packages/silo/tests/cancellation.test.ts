// =============================================================================
// tests/cancellation.test.ts
// =============================================================================
//
// Signals-native, automatic cancellation. Every handle carries a dedicated
// reactive "liveness" node; `store.find`/`store.findQuery` subscribe the current
// active subscriber (the rendering component) to it. When the last observer of a
// handle goes away (its component unmounts), the kernel fires `onUnobserved`;
// after the `gcTimeMs` debounce, if every key in the in-flight chunk is still
// unobserved, the chunk's fiber is interrupted — aborting the request's
// AbortSignal — and its handles reset to idle so a later find refetches.
//
// These node-level tests stand in for React mount/unmount by driving observation
// directly through the kernel: an effect node whose deps are (re-)established by
// running a render thunk under it, exactly like `tracked()`. Disposing the
// effect == unmounting the last component. React-level coverage lives in
// tests/react/cancellation.test.tsx.
//
// Driven through a real DocumentStore with fake timers (the batch window runs on
// Effect.sleep; the gc deferral on setTimeout — both advance together).
// =============================================================================

import { effect } from "@supergrain/kernel";
import { getActiveSub, type ReactiveNode, setActiveSub } from "@supergrain/kernel/internal";
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

/**
 * Observe a handle the way a `tracked()` component does: create an effect node,
 * capture it on the first run, and (re-)run `read` under it so reactive reads —
 * including the `store.find`/`finder.observe` liveness subscription — are linked
 * to that node. The returned disposer is the "unmount": disposing unlinks the
 * deps, dropping the last observer.
 */
function observe(read: () => void): () => void {
  let node: ReactiveNode | undefined;
  return effect(() => {
    if (node === undefined) {
      node = getActiveSub();
    }
    const prev = setActiveSub(node);
    try {
      read();
    } finally {
      setActiveSub(prev);
    }
  });
}

describe("observation-driven cancellation", () => {
  it("interrupts an in-flight fetch and aborts the wire when the last observer leaves", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    let handle = makeIdleHandle<Types["user"]>();
    const unobserve = observe(() => {
      handle = store.find("user", "1") as typeof handle;
    });
    await tick(); // window elapses → chunk fiber forked → request in flight

    expect(c.calls).toEqual([["1"]]);
    expect(handle.isFetching).toBe(true);
    expect(c.signal?.aborted).toBe(false);

    unobserve(); // last observer gone
    await tick(); // gc(0) fires next tick → interrupt → AbortController.abort()

    expect(c.signal?.aborted).toBe(true);
    // Handle reset to idle so renewed interest refetches.
    expect(handle.isFetching).toBe(false);
    expect(handle.status).toBe("pending");
    expect(handle.value).toBeUndefined();
  });

  it("keeps the fetch while any key in the batch still has an observer", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    const unobs1 = observe(() => void store.find("user", "1"));
    const unobs2 = observe(() => void store.find("user", "2")); // same window → one chunk ["1","2"]
    await tick();
    expect(c.calls).toEqual([["1", "2"]]);

    unobs2();
    await tick();
    expect(c.signal?.aborted).toBe(false); // "1" still observed → chunk kept

    unobs1();
    await tick();
    expect(c.signal?.aborted).toBe(true); // both abandoned → interrupted
  });

  it("a re-observe before the next tick cancels the pending interrupt", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    const unobserve = observe(() => void store.find("user", "1"));
    await tick();

    unobserve();
    const unobserveAgain = observe(() => void store.find("user", "1")); // synchronous re-observe
    await tick();

    expect(c.signal?.aborted).toBe(false); // interrupt cancelled (onObserved cleared the timer)
    expect(c.calls).toEqual([["1"]]); // no refetch

    unobserveAgain();
  });

  it("refetches when interest returns after a gc interrupt", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    const unobserve = observe(() => void store.find("user", "1"));
    await tick();
    unobserve();
    await tick();
    expect(c.signal?.aborted).toBe(true);

    // Interest returns: the handle is idle again, so find re-triggers a fetch.
    let handle = makeIdleHandle<Types["user"]>();
    const unobserveAgain = observe(() => {
      handle = store.find("user", "1") as typeof handle;
    });
    await tick();

    expect(c.calls).toEqual([["1"], ["1"]]);
    expect(handle.isFetching).toBe(true);
    unobserveAgain();
  });

  it("discards a late result after interruption even when the adapter ignores the signal", async () => {
    const c = controllable(false); // adapter never honors the abort signal
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    let handle = makeIdleHandle<Types["user"]>();
    const unobserve = observe(() => {
      handle = store.find("user", "1") as typeof handle;
    });
    await tick();

    unobserve();
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

    let handle = makeIdleHandle<Types["user"]>();
    const unobserve = observe(() => {
      handle = store.find("user", "1") as typeof handle;
    });
    await tick();
    expect(handle.isFetching).toBe(true);

    unobserve();
    await tick();

    expect(finalized).toBe(true); // the adapter's own finalizer ran
    expect(handle.isFetching).toBe(false); // reset to idle
  });

  it("does not interrupt a fetch that was never observed", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    const handle = store.find("user", "1"); // no observer (no active sub)
    await tick();
    await tick();

    expect(c.signal?.aborted).toBe(false);
    expect(handle.isFetching).toBe(true); // still in flight, untouched

    c.resolve();
    await tick();
    expect(handle.value).toEqual({ id: "1", name: "User1" });
  });

  it("keeps the fetch while a second observer on the same key remains", async () => {
    const c = controllable();
    const store = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });

    const unobsA = observe(() => void store.find("user", "1"));
    const unobsB = observe(() => void store.find("user", "1")); // two observers, one key
    await tick();

    unobsA(); // one observer left
    await tick();
    expect(c.signal?.aborted).toBe(false);

    unobsB(); // last observer gone
    await tick();
    expect(c.signal?.aborted).toBe(true);
  });

  it("interrupts only the abandoned chunk, leaving other in-flight types alone", async () => {
    const cUser = controllable();
    const cPost = controllable(true, (id) => ({ id, title: `Post${id}` }));
    const store = createDocumentStore<MultiTypes>({
      models: { user: { adapter: cUser.adapter }, post: { adapter: cPost.adapter } },
    });

    const unobsUser = observe(() => void store.find("user", "1"));
    const unobsPost = observe(() => void store.find("post", "1")); // two separate chunks in flight
    await tick();

    unobsUser();
    await tick();

    expect(cUser.signal?.aborted).toBe(true); // abandoned chunk interrupted
    expect(cPost.signal?.aborted).toBe(false); // unrelated chunk untouched

    unobsPost();
    await tick();
  });
});

type QTypes = { search: { params: { q: string }; result: { id: string; type: "search" } } };

describe("query cancellation", () => {
  it("interrupts an in-flight query fetch when its last observer leaves", async () => {
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

    let handle = makeIdleHandle<QTypes["search"]["result"]>();
    const unobserve = observe(() => {
      handle = store.findQuery("search", { q: "x" }) as typeof handle;
    });
    await tick();
    expect(handle.isFetching).toBe(true);
    expect(signal?.aborted).toBe(false);

    unobserve();
    await tick();

    expect(signal?.aborted).toBe(true);
    expect(handle.isFetching).toBe(false);
    expect(handle.status).toBe("pending");
  });
});

describe("Finder observation (unit)", () => {
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

    const unobserve = observe(() => finder.observe("documents", "user", "1", handle));
    finder.queueDocument("user", "1");
    await tick(); // window → chunk in flight

    state.documents.get("user")!.delete("1"); // handle evicted before interrupt
    unobserve();
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

    const unobserve = observe(() => finder.observe("documents", "user", "1", handle));
    finder.queueDocument("user", "1");
    await tick();

    state.documents.delete("user"); // whole bucket gone
    unobserve();
    await tick();

    expect(c.signal?.aborted).toBe(true);
  });

  it("interrupts a chunk where some keys were queued without ever being observed", async () => {
    const c = controllable();
    const handle1 = makeIdleHandle();
    handle1.isFetching = true;
    const handle2 = makeIdleHandle();
    handle2.isFetching = true;
    const state: InternalState = {
      documents: new Map([
        [
          "user",
          new Map([
            ["1", handle1],
            ["2", handle2],
          ]),
        ],
      ]),
      queries: new Map(),
    };
    const host = createDocumentStore<Types>({ models: { user: { adapter: c.adapter } } });
    const finder = new Finder<Types>({ models: { user: { adapter: c.adapter } } });
    finder.attach(state, host);

    // Observe only "1"; "2" rides the same chunk but is never observed.
    const unobserve = observe(() => finder.observe("documents", "user", "1", handle1));
    finder.queueDocument("user", "1");
    finder.queueDocument("user", "2");
    await tick();
    expect(c.calls).toEqual([["1", "2"]]);

    unobserve();
    await tick(); // gc → maybeInterrupt: "1" unobserved, "2" has no observation entry

    expect(c.signal?.aborted).toBe(true);
  });
});
