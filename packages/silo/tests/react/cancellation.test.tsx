// =============================================================================
// tests/react/cancellation.test.tsx
// =============================================================================
//
// React-level coverage for signals-native, automatic fetch cancellation.
// `useDocument`/`useQuery` are pure reactive reads (no effects, no imperative
// subscription) — yet unmounting the last component observing a handle
// interrupts its in-flight fetch (aborting the AbortSignal) after the `gcTimeMs`
// debounce; a surviving observer keeps it alive; a quick remount does not
// cancel.
// =============================================================================

import { tracked } from "@supergrain/kernel/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type DocumentAdapter, type DocumentStore, type DocumentStoreConfig } from "../../src";
import { createDocumentStoreContext } from "../../src/react";

interface User {
  id: string;
  name: string;
}

type TypeToModel = { user: User };

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  // Unmount everything, then drain any pending gc timers / in-flight fetch
  // interrupts so nothing leaks into the next test file in this browser worker.
  cleanup();
  await tick(80);
});

interface Controllable {
  adapter: DocumentAdapter;
  readonly signal: AbortSignal | undefined;
  readonly calls: number;
}

// A Promise adapter whose request stays pending until aborted; records the
// AbortSignal of the most recent call so tests can assert wire-level abort.
function controllable(): Controllable {
  let signal: AbortSignal | undefined;
  let calls = 0;
  const adapter: DocumentAdapter = {
    find: (ids, ctx) => {
      calls++;
      signal = ctx?.signal;
      return new Promise<Array<unknown>>((resolve, reject) => {
        if (ctx?.signal) {
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
        // Otherwise hangs forever (kept pending for the test's duration).
        void resolve;
        void ids;
      });
    },
  };
  return {
    adapter,
    get signal() {
      return signal;
    },
    get calls() {
      return calls;
    },
  };
}

function makeConfig(c: Controllable, gcTimeMs = 0): DocumentStoreConfig<TypeToModel> {
  return { models: { user: { adapter: c.adapter } }, gcTimeMs };
}

const { Provider, useDocument } = createDocumentStoreContext<DocumentStore<TypeToModel>>();

const UserBadge = tracked(function UserBadge({ userId }: { userId: string }) {
  const handle = useDocument("user", userId);
  return <span>{handle.value !== undefined ? handle.value.name : "loading"}</span>;
});

describe("automatic cancellation via observation", () => {
  it("interrupts the in-flight fetch when the last observer unmounts", async () => {
    const c = controllable();
    const { unmount } = render(
      <Provider config={makeConfig(c)}>
        <UserBadge userId="1" />
      </Provider>,
    );

    await tick(); // batch window elapses → request in flight
    expect(c.calls).toBe(1);
    expect(c.signal?.aborted).toBe(false);

    unmount(); // last observer gone
    await tick(); // gc(0) → interrupt → AbortController.abort()

    expect(c.signal?.aborted).toBe(true);
  });

  it("keeps the fetch alive while another component still observes the handle", async () => {
    const c = controllable();

    function App({ showSecond }: { showSecond: boolean }) {
      return (
        <Provider config={makeConfig(c)}>
          <UserBadge userId="1" />
          {showSecond ? <UserBadge userId="1" /> : null}
        </Provider>
      );
    }

    const { rerender } = render(<App showSecond />);
    await tick();
    expect(c.signal?.aborted).toBe(false);

    rerender(<App showSecond={false} />); // one of two observers unmounts
    await tick();
    expect(c.signal?.aborted).toBe(false); // a surviving observer keeps it alive
  });

  it("does not cancel when a component remounts within the gc window", async () => {
    const c = controllable();
    const config = makeConfig(c, 50);

    const { unmount } = render(
      <Provider config={config}>
        <UserBadge userId="1" />
      </Provider>,
    );
    await tick();
    expect(c.calls).toBe(1);

    unmount();
    // Remount immediately (a fast nav-back), well within the 50ms gc window.
    render(
      <Provider config={config}>
        <UserBadge userId="1" />
      </Provider>,
    );
    await tick(60);

    expect(c.signal?.aborted).toBe(false); // never cancelled
  });

  it("does not cancel across re-renders of a still-mounted observer", async () => {
    // The crux of the coalescing fix: `tracked()` re-renders transiently drop
    // and re-establish the liveness subscription. A naive design would schedule
    // (and race) a cancel on every re-render; here repeated re-renders of a
    // mounted component must never abort its in-flight fetch.
    const c = controllable();
    const Badge = tracked(function Badge({ gen }: { gen: number }) {
      const handle = useDocument("user", "1");
      return (
        <span>
          {gen}:{handle.status}
        </span>
      );
    });

    const { rerender } = render(
      <Provider config={makeConfig(c)}>
        <Badge gen={0} />
      </Provider>,
    );
    await tick();
    expect(c.calls).toBe(1);

    for (let gen = 1; gen <= 5; gen++) {
      rerender(
        <Provider config={makeConfig(c)}>
          <Badge gen={gen} />
        </Provider>,
      );
      await tick(10);
    }

    expect(c.signal?.aborted).toBe(false); // never cancelled while mounted
    expect(c.calls).toBe(1); // and never refetched
  });

  it("useDocument contains no imperative subscription — a plain read still cancels", async () => {
    // Smoke-test that the *only* wiring is the reactive read: a component that
    // merely reads the handle (no effects) drives cancellation on unmount.
    const c = controllable();
    const ReadOnly = tracked(function ReadOnly() {
      const handle = useDocument("user", "42");
      return <span>{handle.status}</span>;
    });

    const { unmount } = render(
      <Provider config={makeConfig(c)}>
        <ReadOnly />
      </Provider>,
    );
    await tick();
    expect(c.signal?.aborted).toBe(false);

    unmount();
    await tick();
    expect(c.signal?.aborted).toBe(true);
  });
});
