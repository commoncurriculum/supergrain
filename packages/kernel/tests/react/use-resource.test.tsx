import { createReactive } from "@supergrain/kernel";
import { tracked, useResource } from "@supergrain/kernel/react";
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
