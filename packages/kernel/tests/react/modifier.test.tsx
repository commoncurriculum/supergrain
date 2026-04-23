import { createReactive } from "@supergrain/kernel";
import { modifier, tracked, useModifier } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => cleanup());

describe("modifier() / useModifier()", () => {
  it("runs setup on attach and cleanup on unmount", () => {
    const setupSpy = vi.fn();
    const cleanupSpy = vi.fn();

    const testModifier = modifier<HTMLDivElement, []>((el) => {
      setupSpy(el);
      return () => cleanupSpy();
    });

    function Component() {
      return <div ref={useModifier(testModifier)} data-testid="target" />;
    }

    const { getByTestId, unmount } = render(<Component />);
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(setupSpy).toHaveBeenCalledWith(getByTestId("target"));
    expect(cleanupSpy).not.toHaveBeenCalled();

    unmount();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it("attaches a DOM event listener and fires on interaction", async () => {
    const clickSpy = vi.fn();

    const onClick = modifier<HTMLButtonElement, [() => void]>((el, handler) => {
      el.addEventListener("click", handler);
      return () => el.removeEventListener("click", handler);
    });

    function Component() {
      return (
        <button ref={useModifier(onClick, () => clickSpy())} data-testid="btn">
          click
        </button>
      );
    }

    const { getByTestId } = render(<Component />);
    await act(async () => {
      getByTestId("btn").click();
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-attach when unrelated renders happen (stable ref)", async () => {
    const setupSpy = vi.fn();
    const cleanupSpy = vi.fn();

    const testMod = modifier<HTMLDivElement, [string]>((_el, _label) => {
      setupSpy();
      return () => cleanupSpy();
    });

    function Component() {
      const [count, setCount] = useState(0);
      // New closure each render, but modifier shouldn't re-attach
      return (
        <>
          <div ref={useModifier(testMod, `count-${count}`)} />
          <button data-testid="bump" onClick={() => setCount((c) => c + 1)}>
            {count}
          </button>
        </>
      );
    }

    const { getByTestId } = render(<Component />);
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).not.toHaveBeenCalled();

    await act(async () => {
      getByTestId("bump").click();
    });
    await act(async () => {
      getByTestId("bump").click();
    });
    // Re-render happened twice, but modifier stayed attached
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it("reruns setup when a signal read directly in setup changes", async () => {
    const store = createReactive({ label: "a" });
    const labels: Array<string> = [];

    const watchStoreLabel = modifier<HTMLDivElement, []>(() => {
      labels.push(store.label); // direct signal read — tracked
    });

    const Component = tracked(() => {
      return <div ref={useModifier(watchStoreLabel)} />;
    });

    render(<Component />);
    expect(labels).toEqual(["a"]);

    await act(async () => {
      store.label = "b";
    });
    expect(labels).toEqual(["a", "b"]);

    await act(async () => {
      store.label = "c";
    });
    expect(labels).toEqual(["a", "b", "c"]);
  });

  it("cleans up between reruns triggered by signal changes", async () => {
    const store = createReactive({ n: 0 });
    const setups: Array<number> = [];
    const cleanups: Array<number> = [];

    const withCounter = modifier<HTMLDivElement, []>(() => {
      const n = store.n;
      setups.push(n);
      return () => cleanups.push(n);
    });

    const Component = tracked(() => {
      return <div ref={useModifier(withCounter)} />;
    });

    render(<Component />);
    expect(setups).toEqual([0]);
    expect(cleanups).toEqual([]);

    await act(async () => {
      store.n = 1;
    });
    expect(setups).toEqual([0, 1]);
    expect(cleanups).toEqual([0]);

    await act(async () => {
      store.n = 2;
    });
    expect(setups).toEqual([0, 1, 2]);
    expect(cleanups).toEqual([0, 1]);
  });
});
