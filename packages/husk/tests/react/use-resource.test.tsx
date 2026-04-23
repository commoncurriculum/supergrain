import { defineResource } from "@supergrain/husk";
import { useResource } from "@supergrain/husk/react";
import { createReactive } from "@supergrain/kernel";
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
