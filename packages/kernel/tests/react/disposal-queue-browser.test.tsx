/// <reference types="react/canary" />
// Browser-environment tests for the deferred disposal queue.
//
// The node suite (tests/core/disposal-queue.test.ts) drives the plain-setTimeout
// fallback with fake timers. This file covers the branch that actually ships to
// users: a real requestAnimationFrame, its nested macrotask, and the backstop
// timer that outlives an already-drained round. Between the two files
// `scheduleFlush` needs no coverage ignore.
import type { ReactiveNode } from "alien-signals/system";

import { createReactive, signal } from "@supergrain/kernel";
import { getActiveSub } from "@supergrain/kernel/internal";
import { tracked } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { describe, it, expect, afterEach } from "vitest";

import { scheduleDisposal } from "../../src/react/disposal-queue";

const queue = (dispose: () => void) => scheduleDisposal({ dispose });

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

    queue(() => ran.push("a"));
    queue(() => ran.push("b"));
    expect(ran).toEqual([]);

    await afterNextFrame();
    expect(ran).toEqual(["a", "b"]);
  });

  it("ignores the backstop timer left over from an already-drained round", async () => {
    const ran: Array<string> = [];

    queue(() => ran.push("first"));
    await afterNextFrame();
    expect(ran).toEqual(["first"]);

    // The round above also armed a ~100ms backstop, which is still pending.
    // Let it fire on an empty queue: it must neither re-run "first" nor clear
    // the scheduled flag out from under a later round.
    await sleep(200);
    expect(ran).toEqual(["first"]);

    // A disposer queued after that stale timer still flushes exactly once.
    queue(() => ran.push("second"));
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
    // Teardown is deferred by the disposal queue, so the graph link outlives
    // the unmount commit.
    expect(effectNode?.deps).toBeTruthy();

    // ...but it always runs. "Deferred, never skipped" is what keeps subscriber
    // lists from leaking.
    await waitUntil(() => !effectNode?.deps);
    expect(effectNode?.deps).toBeFalsy();
  });

  it("unlinks the effect after a real unmount under StrictMode", async () => {
    const store = createReactive({ value: 0 });
    let effectNode: ReactiveNode | undefined;
    const Probe = tracked(() => {
      effectNode = getActiveSub();
      return <span>{store.value}</span>;
    });

    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    // StrictMode's extra unmount and remount must not have disposed it.
    await afterNextFrame();
    expect(effectNode?.deps).toBeTruthy();

    unmount();
    await waitUntil(() => !effectNode?.deps);
  });

  it("stays reactive when <Activity> hides it long enough to dispose, then shows it", async () => {
    const count = signal(0);
    const Probe = tracked(() => <span data-testid="v">{count()}</span>);
    const app = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <Probe />
      </Activity>
    );

    const { rerender, getByTestId } = render(app("visible"));
    rerender(app("hidden"));
    // Past the disposal queue's flush (and its backstop).
    await sleep(200);
    rerender(app("visible"));

    await act(async () => {
      count(1);
    });
    expect(getByTestId("v").textContent).toBe("1");
  });
});
