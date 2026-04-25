import { behavior, useBehavior } from "@supergrain/husk/react";
import { createGrain } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => cleanup());

describe("behavior() / useBehavior()", () => {
  it("runs setup on attach and cleanup on unmount", () => {
    const setupSpy = vi.fn();
    const cleanupSpy = vi.fn();

    const testModifier = behavior<HTMLDivElement, []>((el) => {
      setupSpy(el);
      return () => cleanupSpy();
    });

    function Component() {
      return <div ref={useBehavior(testModifier)} data-testid="target" />;
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

    const onClick = behavior<HTMLButtonElement, [() => void]>((el, handler) => {
      el.addEventListener("click", handler);
      return () => el.removeEventListener("click", handler);
    });

    function Component() {
      return (
        <button ref={useBehavior(onClick, () => clickSpy())} data-testid="btn">
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

    const testMod = behavior<HTMLDivElement, [string]>((_el, _label) => {
      setupSpy();
      return () => cleanupSpy();
    });

    function Component() {
      const [count, setCount] = useState(0);
      // New closure each render, but behavior shouldn't re-attach
      return (
        <>
          <div ref={useBehavior(testMod, `count-${count}`)} />
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
    // Re-render happened twice, but behavior stayed attached
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it("reruns setup when a signal read directly in setup changes", async () => {
    const store = createGrain({ label: "a" });
    const labels: Array<string> = [];

    const watchStoreLabel = behavior<HTMLDivElement, []>(() => {
      labels.push(store.label); // direct signal read — tracked
    });

    const Component = tracked(() => {
      return <div ref={useBehavior(watchStoreLabel)} />;
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
    const store = createGrain({ n: 0 });
    const setups: Array<number> = [];
    const cleanups: Array<number> = [];

    const withCounter = behavior<HTMLDivElement, []>(() => {
      const n = store.n;
      setups.push(n);
      return () => cleanups.push(n);
    });

    const Component = tracked(() => {
      return <div ref={useBehavior(withCounter)} />;
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

describe("onClickOutside popover scenario", () => {
  const onClickOutside = behavior<HTMLElement, [() => void]>((el, onOutside) => {
    const handler = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  });

  it("fires onClose for outside click, not for inside click", async () => {
    const onClose = vi.fn();

    function App() {
      return (
        <>
          <div ref={useBehavior(onClickOutside, onClose)} data-testid="popover">
            <button type="button" data-testid="inside">
              inside
            </button>
          </div>
          <button type="button" data-testid="outside">
            outside
          </button>
        </>
      );
    }

    const { getByTestId } = render(<App />);

    await act(async () => {
      getByTestId("inside").click();
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      getByTestId("outside").click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      getByTestId("outside").click();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("parent re-renders do not re-attach the behavior", async () => {
    const attachSpy = vi.fn();
    const cleanupSpy = vi.fn();

    const tracking = behavior<HTMLElement, [() => void]>((el, onOutside) => {
      attachSpy();
      const handler = (e: MouseEvent) => {
        if (!el.contains(e.target as Node)) onOutside();
      };
      document.addEventListener("click", handler);
      return () => {
        cleanupSpy();
        document.removeEventListener("click", handler);
      };
    });

    function Parent() {
      const [count, setCount] = useState(0);
      // Fresh closure every render — must not cause re-attach
      return (
        <>
          <div ref={useBehavior(tracking, () => count)} data-testid="popover">
            popover
          </div>
          <button type="button" data-testid="bump" onClick={() => setCount((c) => c + 1)}>
            {count}
          </button>
        </>
      );
    }

    const { getByTestId } = render(<Parent />);
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).not.toHaveBeenCalled();

    await act(async () => {
      getByTestId("bump").click();
    });
    await act(async () => {
      getByTestId("bump").click();
    });
    await act(async () => {
      getByTestId("bump").click();
    });

    // Three parent re-renders, but the behavior stayed attached
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).not.toHaveBeenCalled();
    expect(getByTestId("bump").textContent).toBe("3");
  });

  it("unmount removes the document listener — subsequent clicks do not fire handler", async () => {
    const onClose = vi.fn();

    function App() {
      return (
        <div ref={useBehavior(onClickOutside, onClose)} data-testid="popover">
          popover
        </div>
      );
    }

    const { unmount } = render(<App />);

    // Detach the popover
    unmount();

    // After unmount, clicking the document must NOT invoke onClose —
    // the cleanup should have removed the listener.
    await act(async () => {
      document.body.click();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("multiple mounted popovers each get their own listener, and cleanup independently", async () => {
    const closeA = vi.fn();
    const closeB = vi.fn();

    function Popover({ testid, onClose }: { testid: string; onClose: () => void }) {
      return (
        <div ref={useBehavior(onClickOutside, onClose)} data-testid={testid}>
          {testid}
        </div>
      );
    }

    function App({ showB }: { showB: boolean }) {
      return (
        <>
          <Popover testid="a" onClose={closeA} />
          {showB ? <Popover testid="b" onClose={closeB} /> : null}
          <button type="button" data-testid="outside">
            outside
          </button>
        </>
      );
    }

    const { getByTestId, rerender } = render(<App showB={true} />);

    // Clicking inside A doesn't close A, but it IS outside of B, so B closes
    await act(async () => {
      getByTestId("a").click();
    });
    expect(closeA).toHaveBeenCalledTimes(0);
    expect(closeB).toHaveBeenCalledTimes(1);

    // Unmount B, keep A mounted
    rerender(<App showB={false} />);

    await act(async () => {
      getByTestId("outside").click();
    });
    // A fires, B is gone (its listener was removed on unmount)
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
  });
});
