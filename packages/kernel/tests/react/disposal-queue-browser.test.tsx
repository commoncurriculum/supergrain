// Browser-environment tests for the deferred disposal queue.
//
// The node suite (tests/core/disposal-queue.test.ts) drives the plain-setTimeout
// fallback with fake timers. This file covers the branch that actually ships to
// users: a real requestAnimationFrame, its nested macrotask, and the backstop
// timer that outlives an already-drained round. Between the two files
// `scheduleFlush` needs no coverage ignore.
import type { ReactiveNode } from "alien-signals/system";

import { createReactive } from "@supergrain/kernel";
import { getActiveSub } from "@supergrain/kernel/internal";
import { tracked } from "@supergrain/kernel/react";
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";

import { scheduleDisposal } from "../../src/react/disposal-queue";

afterEach(() => cleanup());

/**
 * Resolve in the first macrotask after the next frame — the exact slot
 * `scheduleFlush` targets. Our rAF callback was registered first, so its nested
 * `setTimeout(flush, 0)` is queued ahead of this one and the flush has already
 * run by the time this resolves.
 */
function afterNextFrame(): Promise<void> {
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeout) {
      throw new Error(`Timed out after ${timeout}ms waiting for condition`);
    }
    await sleep(10);
  }
}

describe("scheduleDisposal (browser / requestAnimationFrame path)", () => {
  it("does not run the disposer synchronously, then flushes after the next frame", async () => {
    const ran: Array<string> = [];

    scheduleDisposal(() => ran.push("a"));
    scheduleDisposal(() => ran.push("b"));
    expect(ran).toEqual([]);

    await afterNextFrame();
    expect(ran).toEqual(["a", "b"]);
  });

  it("ignores the backstop timer left over from an already-drained round", async () => {
    const ran: Array<string> = [];

    scheduleDisposal(() => ran.push("first"));
    await afterNextFrame();
    expect(ran).toEqual(["first"]);

    // The round above also armed a ~100ms backstop, which is still pending.
    // Let it fire on an empty queue: it must neither re-run "first" nor clear
    // the scheduled flag out from under a later round.
    await sleep(200);
    expect(ran).toEqual(["first"]);

    // A disposer queued after that stale timer still flushes exactly once.
    scheduleDisposal(() => ran.push("second"));
    await afterNextFrame();
    expect(ran).toEqual(["first", "second"]);
  });

  // Throw-during-drain is covered in tests/core, where fake timers make the
  // rethrow synchronously catchable. Reproducing it here would only leave an
  // uncaught error in the browser run.
});

describe("tracked() teardown", () => {
  it("unlinks the component's effect from the signal graph after unmount", async () => {
    const store = createReactive({ value: 0 });
    let effectNode: ReactiveNode | undefined;

    const Probe = tracked(() => {
      // tracked() points activeSub at this component's effect node before
      // calling the component, so this captures the node whose disposal we
      // want to observe. `deps` is the alien-signals dependency list: non-empty
      // while linked, cleared on dispose.
      effectNode = getActiveSub();
      return <span>{store.value}</span>;
    });

    const { unmount } = render(<Probe />);
    expect(effectNode?.deps).toBeTruthy();

    unmount();
    // Teardown is deferred — by useDisposeOnUnmount's StrictMode timer in dev
    // and by the disposal queue in every build — so the graph link outlives the
    // unmount commit.
    expect(effectNode?.deps).toBeTruthy();

    // ...but it always runs. "Deferred, never skipped" is what keeps subscriber
    // lists from leaking.
    await waitUntil(() => !effectNode?.deps);
    expect(effectNode?.deps).toBeFalsy();
  });
});
