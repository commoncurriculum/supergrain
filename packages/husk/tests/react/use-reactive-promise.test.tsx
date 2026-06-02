import { useReactivePromise } from "@supergrain/husk/react";
import { createReactive } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
import { Effect } from "effect";
import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => cleanup());

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useReactivePromise()", () => {
  it("shows pending then resolves and renders data", async () => {
    const d = deferred<number>();

    const Component = tracked(() => {
      const rp = useReactivePromise(() => Effect.promise(() => d.promise));
      if (rp.isPending && !rp.isReady) return <span data-testid="v">loading</span>;
      return <span data-testid="v">{rp.data}</span>;
    });

    const { getByTestId } = render(<Component />);
    expect(getByTestId("v").textContent).toBe("loading");

    await act(async () => {
      d.resolve(42);
      await d.promise;
    });
    expect(getByTestId("v").textContent).toBe("42");
  });

  it("reruns when a tracked signal in asyncFn's sync prefix changes", async () => {
    const store = createReactive({ n: 1 });
    const runs: number[] = [];

    const Component = tracked(() => {
      const rp = useReactivePromise(() => {
        runs.push(store.n);
        return Effect.succeed(store.n * 10);
      });
      return <span data-testid="v">{rp.isReady ? rp.data : "…"}</span>;
    });

    const { getByTestId } = render(<Component />);
    await vi.waitFor(() => expect(getByTestId("v").textContent).toBe("10"));
    expect(runs).toEqual([1]);

    await act(async () => {
      store.n = 5;
    });
    await vi.waitFor(() => expect(runs).toEqual([1, 5]));
    await vi.waitFor(() => expect(getByTestId("v").textContent).toBe("50"));
  });

  it("interrupts the in-flight Effect on rerun (latest wins)", async () => {
    const store = createReactive({ n: 1 });
    const interrupted: number[] = [];

    const Component = tracked(() => {
      const rp = useReactivePromise(() => {
        const current = store.n; // tracked
        if (current === 1) {
          // Slow run that should be interrupted before it settles.
          return Effect.sleep("1 second").pipe(
            Effect.as(current),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted.push(current);
              }),
            ),
          );
        }
        return Effect.succeed(current);
      });
      return <span data-testid="v">{rp.isReady ? rp.data : "…"}</span>;
    });

    const { getByTestId } = render(<Component />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      store.n = 2;
    });

    // The slow first run is interrupted; only the second run settles.
    await vi.waitFor(() => expect(getByTestId("v").textContent).toBe("2"));
    await vi.waitFor(() => expect(interrupted).toEqual([1]));
  });

  it("re-renders only the consuming component, not its sibling", async () => {
    const store = createReactive({ n: 1 });
    const consumerRenders = vi.fn();
    const siblingRenders = vi.fn();

    const Consumer = tracked(() => {
      consumerRenders();
      const rp = useReactivePromise(() => Effect.succeed(store.n));
      return <span data-testid="consumer">{rp.isReady ? rp.data : "…"}</span>;
    });

    const Sibling = tracked(() => {
      siblingRenders();
      return <span data-testid="sibling">static</span>;
    });

    const App = () => (
      <>
        <Consumer />
        <Sibling />
      </>
    );

    const { getByTestId } = render(<App />);
    await vi.waitFor(() => expect(getByTestId("consumer").textContent).toBe("1"));

    const initialSiblingRenders = siblingRenders.mock.calls.length;
    const initialConsumerRenders = consumerRenders.mock.calls.length;

    await act(async () => {
      store.n = 99;
    });
    await vi.waitFor(() => expect(getByTestId("consumer").textContent).toBe("99"));

    // Consumer re-rendered due to rp.data change
    expect(consumerRenders.mock.calls.length).toBeGreaterThan(initialConsumerRenders);
    // Sibling did NOT re-render — it doesn't read the resource or store.n
    expect(siblingRenders.mock.calls.length).toBe(initialSiblingRenders);
  });

  it("disposes on unmount — in-flight Effect interrupts, no further reruns", async () => {
    const store = createReactive({ n: 1 });
    let interrupted = false;
    const runs = vi.fn();

    const Component = tracked(() => {
      useReactivePromise(() => {
        runs();
        store.n; // tracked
        // Never settles; on dispose the Effect is interrupted.
        return Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        );
      });
      return null;
    });

    const { unmount } = render(<Component />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(runs).toHaveBeenCalledTimes(1);
    expect(interrupted).toBe(false);

    unmount();
    // Dispose is deferred to a setTimeout so a StrictMode remount can
    // cancel it; flush before asserting torn-down state.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await vi.waitFor(() => expect(interrupted).toBe(true));

    // After unmount, signal changes must not cause reruns
    await act(async () => {
      store.n = 42;
    });
    expect(runs).toHaveBeenCalledTimes(1);
  });
});
