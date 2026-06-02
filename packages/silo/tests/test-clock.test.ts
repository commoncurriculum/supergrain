// =============================================================================
// tests/test-clock.test.ts
// =============================================================================
//
// The batch window is `Effect.sleep(batchWindowMs)`, so the whole engine runs
// on Effect's clock and is drivable with a `TestClock` — deterministically, no
// real time, no global timer patching. (This file deliberately does NOT use
// vitest fake timers, which would deadlock the ManagedRuntime's scheduler.)
// =============================================================================

import { Effect, ManagedRuntime, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vitest";

import { createDocumentStore } from "../src";
import { Finder, type InternalState } from "../src/finder";
import { makeIdleHandle } from "../src/transitions";

type Types = { user: { id: string; name: string } };

describe("batch window on Effect's clock (TestClock)", () => {
  it("drains only after batchWindowMs elapses on the injected clock", async () => {
    const runtime = ManagedRuntime.make(TestContext.TestContext);
    const scheduler = {
      runFork: <A, E>(e: Effect.Effect<A, E>) => runtime.runFork(e),
      runPromise: <A, E>(e: Effect.Effect<A, E>) => runtime.runPromise(e),
    };

    const calls: Array<Array<string>> = [];
    const handle = makeIdleHandle();
    handle.isFetching = true;
    const state: InternalState = {
      documents: new Map([["user", new Map([["1", handle]])]]),
      queries: new Map(),
    };
    const store = createDocumentStore<Types>({
      models: { user: { adapter: { find: async () => [] } } },
    });

    const finder = new Finder<Types>(
      {
        models: {
          user: {
            adapter: {
              find: (ids) => {
                calls.push([...ids]);
                return Effect.succeed(ids.map((id) => ({ id, name: `User${id}` })));
              },
            },
          },
        },
      },
      scheduler,
    );
    finder.attach(state, store);
    finder.queueDocument("user", "1");

    // The window fiber is asleep on the TestClock — nothing has run yet.
    await runtime.runPromise(TestClock.adjust("14 millis"));
    expect(calls).toHaveLength(0);

    // Crossing the 15ms window wakes the drain.
    await runtime.runPromise(TestClock.adjust("1 millis"));
    expect(calls).toEqual([["1"]]);

    await runtime.dispose();
  });
});
