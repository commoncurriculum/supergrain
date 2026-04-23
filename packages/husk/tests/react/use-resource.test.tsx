import { defineResource, dispose, resource } from "@supergrain/husk";
import { useResource } from "@supergrain/husk/react";
import { createReactive, signal } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => cleanup());

describe("useResource()", () => {
  it("exposes the reactive state to JSX", () => {
    const Component = tracked(() => {
      const r = useResource({ value: 7 }, (state) => {
        state.value = 42;
      });
      return <span data-testid="val">{r.value}</span>;
    });

    const { getByTestId } = render(<Component />);
    expect(getByTestId("val").textContent).toBe("42");
  });

  it("reruns setup when a tracked signal changes", async () => {
    const store = createReactive({ n: 1 });
    const setupSpy = vi.fn();

    const Component = tracked(() => {
      const r = useResource({ value: 0 }, (state) => {
        setupSpy();
        state.value = store.n * 10;
      });
      return <span data-testid="val">{r.value}</span>;
    });

    const { getByTestId } = render(<Component />);
    expect(getByTestId("val").textContent).toBe("10");
    expect(setupSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.n = 3;
    });
    expect(getByTestId("val").textContent).toBe("30");
    expect(setupSpy).toHaveBeenCalledTimes(2);
  });

  it("binds a defineResource factory and reruns when argsFn reactive reads change", async () => {
    const setupSpy = vi.fn();
    const factory = defineResource<number, { doubled: number }>(
      () => ({ doubled: 0 }),
      (state, n) => {
        setupSpy(n);
        state.doubled = n * 2;
      },
    );
    const store = createReactive({ n: 3 });

    const Component = tracked(() => {
      const r = useResource(factory, () => store.n);
      return <span data-testid="val">{r.doubled}</span>;
    });

    const { getByTestId } = render(<Component />);
    expect(getByTestId("val").textContent).toBe("6");
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(setupSpy).toHaveBeenLastCalledWith(3);

    await act(async () => {
      store.n = 5;
    });
    expect(getByTestId("val").textContent).toBe("10");
    expect(setupSpy).toHaveBeenCalledTimes(2);
    expect(setupSpy).toHaveBeenLastCalledWith(5);
  });

  it("supports a no-args factory (Args = void)", () => {
    let counter = 0;
    const factory = defineResource<void, { n: number }>(
      () => ({ n: 0 }),
      (state) => {
        state.n = ++counter;
      },
    );

    const Component = tracked(() => {
      const r = useResource(factory);
      return <span data-testid="val">{r.n}</span>;
    });

    const { getByTestId } = render(<Component />);
    expect(getByTestId("val").textContent).toBe("1");
  });

  it("inline: sibling component does NOT re-render when tracked state changes", async () => {
    const store = createReactive({ n: 1 });
    const consumerRenders = vi.fn();
    const siblingRenders = vi.fn();

    const Consumer = tracked(() => {
      consumerRenders();
      const r = useResource({ v: 0 }, (state) => {
        state.v = store.n;
      });
      return <span data-testid="consumer">{r.v}</span>;
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
    const initialSiblingRenders = siblingRenders.mock.calls.length;

    await act(async () => {
      store.n = 42;
    });

    expect(getByTestId("consumer").textContent).toBe("42");
    expect(siblingRenders.mock.calls.length).toBe(initialSiblingRenders);
    expect(consumerRenders.mock.calls.length).toBeGreaterThan(1);
  });

  it("factory: sibling component does NOT re-render when argsFn state changes", async () => {
    const factory = defineResource<number, { v: number }>(
      () => ({ v: 0 }),
      (state, n) => {
        state.v = n;
      },
    );
    const store = createReactive({ n: 1 });
    const consumerRenders = vi.fn();
    const siblingRenders = vi.fn();

    const Consumer = tracked(() => {
      consumerRenders();
      const r = useResource(factory, () => store.n);
      return <span data-testid="consumer">{r.v}</span>;
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
    const initialSiblingRenders = siblingRenders.mock.calls.length;

    await act(async () => {
      store.n = 42;
    });

    expect(getByTestId("consumer").textContent).toBe("42");
    expect(siblingRenders.mock.calls.length).toBe(initialSiblingRenders);
    expect(consumerRenders.mock.calls.length).toBeGreaterThan(1);
  });

  it("factory: parent does NOT re-render when resource state updates", async () => {
    const factory = defineResource<number, { v: number }>(
      () => ({ v: 0 }),
      (state, n) => {
        state.v = n;
      },
    );
    const store = createReactive({ n: 1 });
    const parentRenders = vi.fn();
    const childRenders = vi.fn();

    const Child = tracked(() => {
      childRenders();
      const r = useResource(factory, () => store.n);
      return <span data-testid="child">{r.v}</span>;
    });

    const Parent = tracked(() => {
      parentRenders();
      // Parent does not read store.n directly — only the resource does.
      return <Child />;
    });

    const { getByTestId } = render(<Parent />);
    const initialParentRenders = parentRenders.mock.calls.length;

    await act(async () => {
      store.n = 7;
    });

    expect(getByTestId("child").textContent).toBe("7");
    expect(parentRenders.mock.calls.length).toBe(initialParentRenders);
    expect(childRenders.mock.calls.length).toBeGreaterThan(1);
  });

  it("disposes on unmount — cleanups run, further signal changes are ignored", async () => {
    const store = createReactive({ n: 1 });
    const cleanupSpy = vi.fn();
    const setupSpy = vi.fn();

    const Component = tracked(() => {
      const r = useResource({ value: 0 }, (state) => {
        setupSpy();
        state.value = store.n;
        return cleanupSpy;
      });
      return <span>{r.value}</span>;
    });

    const { unmount } = render(<Component />);
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).not.toHaveBeenCalled();

    unmount();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.n = 99;
    });
    // Disposed — setup must not run again
    expect(setupSpy).toHaveBeenCalledTimes(1);
  });
});

describe("module-scope resource consumed from tracked()", () => {
  it("reruns setup and updates tracked consumer on signal change, with cleanup", async () => {
    const n = signal(1);
    const setupSpy = vi.fn();
    const cleanupSpy = vi.fn();

    const r = resource({ doubled: 0 }, (state) => {
      setupSpy(n());
      state.doubled = n() * 2;
      return () => cleanupSpy();
    });

    try {
      const Consumer = tracked(() => <span data-testid="v">{r.doubled}</span>);

      const { getByTestId } = render(<Consumer />);
      expect(getByTestId("v").textContent).toBe("2");
      expect(setupSpy).toHaveBeenCalledTimes(1);
      expect(cleanupSpy).not.toHaveBeenCalled();

      await act(async () => {
        n(5);
      });
      expect(getByTestId("v").textContent).toBe("10");
      expect(setupSpy).toHaveBeenCalledTimes(2);
      // Cleanup must run BEFORE the rerun's setup
      expect(cleanupSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        n(7);
      });
      expect(getByTestId("v").textContent).toBe("14");
      expect(setupSpy).toHaveBeenCalledTimes(3);
      expect(cleanupSpy).toHaveBeenCalledTimes(2);
    } finally {
      dispose(r);
    }
  });

  it("multiple tracked consumers share state of a single module-scope resource", async () => {
    const n = signal(1);
    const setupSpy = vi.fn();

    const r = resource({ value: 0 }, (state) => {
      setupSpy();
      state.value = n();
    });

    try {
      const A = tracked(() => <span data-testid="a">{r.value}</span>);
      const B = tracked(() => <span data-testid="b">{r.value}</span>);

      const { getByTestId } = render(
        <>
          <A />
          <B />
        </>,
      );
      // Setup ran once at resource creation — not once per consumer
      expect(setupSpy).toHaveBeenCalledTimes(1);
      expect(getByTestId("a").textContent).toBe("1");
      expect(getByTestId("b").textContent).toBe("1");

      await act(async () => {
        n(42);
      });
      expect(setupSpy).toHaveBeenCalledTimes(2);
      expect(getByTestId("a").textContent).toBe("42");
      expect(getByTestId("b").textContent).toBe("42");
    } finally {
      dispose(r);
    }
  });

  it("keeps running when one consumer unmounts — not tied to React lifecycle", async () => {
    const n = signal(1);
    const setupSpy = vi.fn();

    const r = resource({ value: 0 }, (state) => {
      setupSpy();
      state.value = n();
    });

    try {
      const Consumer = tracked(() => <span>{r.value}</span>);
      const { unmount } = render(<Consumer />);
      expect(setupSpy).toHaveBeenCalledTimes(1);

      unmount();

      // Resource is NOT disposed by consumer unmount (unlike useResource).
      // Setup still reacts to signal changes.
      await act(async () => {
        n(99);
      });
      expect(setupSpy).toHaveBeenCalledTimes(2);
      expect(r.value).toBe(99);
    } finally {
      dispose(r);
    }
  });

  it("async module-scope resource — consumer sees loading → data → re-loading → new data", async () => {
    type State = { data: number | null; isLoading: boolean };
    const input = signal(1);
    const deferreds: Array<{ resolve: (v: number) => void }> = [];

    const r = resource<State>({ data: null, isLoading: true }, async (state, { abortSignal }) => {
      input(); // tracked read — reruns on signal change
      state.isLoading = true;
      const promise = new Promise<number>((resolve) => {
        deferreds.push({ resolve });
      });
      const value = await promise;
      if (abortSignal.aborted) return;
      state.data = value;
      state.isLoading = false;
    });

    try {
      const Consumer = tracked(() => (
        <span data-testid="v">{r.isLoading ? "loading" : String(r.data)}</span>
      ));

      const { getByTestId } = render(<Consumer />);
      expect(getByTestId("v").textContent).toBe("loading");

      await act(async () => {
        deferreds[0]!.resolve(10);
        await Promise.resolve();
      });
      expect(getByTestId("v").textContent).toBe("10");

      // Trigger rerun — should abort pending (none) and show loading again
      await act(async () => {
        input(2);
        await Promise.resolve();
      });
      expect(getByTestId("v").textContent).toBe("loading");

      await act(async () => {
        deferreds[1]!.resolve(20);
        await Promise.resolve();
      });
      expect(getByTestId("v").textContent).toBe("20");
    } finally {
      dispose(r);
    }
  });

  it("module-scope async resource aborts in-flight work on signal change", async () => {
    const input = signal(1);
    const signals: Array<AbortSignal> = [];
    let resolveFirst!: (v: number) => void;
    let resolveSecond!: (v: number) => void;

    const r = resource({ data: null as number | null }, async (state, { abortSignal }) => {
      signals.push(abortSignal);
      const current = input();
      const value = await new Promise<number>((resolve) => {
        if (current === 1) resolveFirst = resolve;
        else resolveSecond = resolve;
      });
      if (abortSignal.aborted) return;
      state.data = value;
    });

    try {
      const Consumer = tracked(() => (
        <span data-testid="v">{r.data === null ? "none" : String(r.data)}</span>
      ));

      const { getByTestId } = render(<Consumer />);
      expect(signals).toHaveLength(1);
      expect(signals[0]!.aborted).toBe(false);

      // Change signal before first fetch resolves
      await act(async () => {
        input(2);
        await Promise.resolve();
      });
      expect(signals).toHaveLength(2);
      expect(signals[0]!.aborted).toBe(true);
      expect(signals[1]!.aborted).toBe(false);

      // Resolving the stale (aborted) fetch must NOT land state
      await act(async () => {
        resolveFirst(111);
        await Promise.resolve();
      });
      expect(getByTestId("v").textContent).toBe("none");

      // Resolving the current fetch lands state
      await act(async () => {
        resolveSecond(222);
        await Promise.resolve();
      });
      expect(getByTestId("v").textContent).toBe("222");
    } finally {
      dispose(r);
    }
  });

  it("defineResource factory at module scope — one instance, many tracked consumers", async () => {
    const input = signal(3);
    const setupSpy = vi.fn();

    const fetchDoubled = defineResource<number, { doubled: number }>(
      () => ({ doubled: 0 }),
      (state, n) => {
        setupSpy(n);
        state.doubled = n * 2;
      },
    );

    const instance = fetchDoubled(() => input());

    try {
      const A = tracked(() => <span data-testid="a">{instance.doubled}</span>);
      const B = tracked(() => <span data-testid="b">{instance.doubled}</span>);

      const { getByTestId } = render(
        <>
          <A />
          <B />
        </>,
      );
      expect(setupSpy).toHaveBeenCalledTimes(1);
      expect(setupSpy).toHaveBeenLastCalledWith(3);
      expect(getByTestId("a").textContent).toBe("6");
      expect(getByTestId("b").textContent).toBe("6");

      await act(async () => {
        input(10);
      });
      expect(setupSpy).toHaveBeenCalledTimes(2);
      expect(setupSpy).toHaveBeenLastCalledWith(10);
      expect(getByTestId("a").textContent).toBe("20");
      expect(getByTestId("b").textContent).toBe("20");
    } finally {
      dispose(instance);
    }
  });
});
