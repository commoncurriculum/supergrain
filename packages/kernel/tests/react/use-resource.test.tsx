import { createReactive } from "@supergrain/kernel";
import { tracked, useResource } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => cleanup());

describe("useResource()", () => {
  it("exposes the resource value reactively", () => {
    const Component = tracked(() => {
      const r = useResource(7, ({ set }) => set(42));
      return <span data-testid="val">{r.value}</span>;
    });

    const { getByTestId } = render(<Component />);
    expect(getByTestId("val").textContent).toBe("42");
  });

  it("reruns setup when a tracked signal changes", async () => {
    const store = createReactive({ n: 1 });
    const setupSpy = vi.fn();

    const Component = tracked(() => {
      const r = useResource(0, ({ set }) => {
        setupSpy();
        set(store.n * 10);
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
    const cleanup = vi.fn();
    const setupSpy = vi.fn();

    const Component = tracked(() => {
      const r = useResource(0, ({ set }) => {
        setupSpy();
        set(store.n);
        return cleanup;
      });
      return <span>{r.value}</span>;
    });

    const { unmount } = render(<Component />);
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.n = 99;
    });
    // Resource is disposed — setup must not run again
    expect(setupSpy).toHaveBeenCalledTimes(1);
  });
});
