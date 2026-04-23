import { useReactivePromise } from "@supergrain/husk/react";
import { createReactive } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
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
      const rp = useReactivePromise(() => d.promise);
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
      const rp = useReactivePromise(async () => {
        runs.push(store.n);
        return store.n * 10;
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

  it("aborts in-flight fetch on rerun (old signal tripped)", async () => {
    const store = createReactive({ n: 1 });
    const signals: AbortSignal[] = [];

    const Component = tracked(() => {
      useReactivePromise(async (signal) => {
        const current = store.n; // tracked
        signals.push(signal);
        return current;
      });
      return <span data-testid="v">ok</span>;
    });

    render(<Component />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    await act(async () => {
      store.n = 2;
      await Promise.resolve();
    });
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it("re-renders only the consuming component, not its sibling", async () => {
    const store = createReactive({ n: 1 });
    const consumerRenders = vi.fn();
    const siblingRenders = vi.fn();

    const Consumer = tracked(() => {
      consumerRenders();
      const rp = useReactivePromise(async () => store.n);
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

  it("disposes on unmount — in-flight signal aborts, no further reruns", async () => {
    const store = createReactive({ n: 1 });
    let lastSignal: AbortSignal | null = null;
    const runs = vi.fn();

    const Component = tracked(() => {
      useReactivePromise(async (signal) => {
        runs();
        const current = store.n; // tracked
        lastSignal = signal;
        return current;
      });
      return null;
    });

    const { unmount } = render(<Component />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(runs).toHaveBeenCalledTimes(1);
    expect(lastSignal!.aborted).toBe(false);

    unmount();
    expect(lastSignal!.aborted).toBe(true);

    // After unmount, signal changes must not cause reruns
    await act(async () => {
      store.n = 42;
    });
    expect(runs).toHaveBeenCalledTimes(1);
  });
});
