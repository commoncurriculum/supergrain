import { modifier, useModifier } from "@supergrain/husk/react";
import { createReactive } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
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

describe("onClickOutside popover scenario", () => {
  const onClickOutside = modifier<HTMLElement, [() => void]>((el, onOutside) => {
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
          <div ref={useModifier(onClickOutside, onClose)} data-testid="popover">
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

  it("parent re-renders do not re-attach the modifier", async () => {
    const attachSpy = vi.fn();
    const cleanupSpy = vi.fn();

    const tracking = modifier<HTMLElement, [() => void]>((el, onOutside) => {
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
          <div ref={useModifier(tracking, () => count)} data-testid="popover">
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

    // Three parent re-renders, but the modifier stayed attached
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).not.toHaveBeenCalled();
    expect(getByTestId("bump").textContent).toBe("3");
  });

  it("unmount removes the document listener — subsequent clicks do not fire handler", async () => {
    const onClose = vi.fn();

    function App() {
      return (
        <div ref={useModifier(onClickOutside, onClose)} data-testid="popover">
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
        <div ref={useModifier(onClickOutside, onClose)} data-testid={testid}>
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

describe("error handling", () => {
  it("logs and swallows an error thrown by a modifier cleanup function", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const throwingMod = modifier<HTMLDivElement, []>(() => {
      return () => {
        throw new Error("cleanup-throw");
      };
    });

    function Component() {
      return <div ref={useModifier(throwingMod)} data-testid="el" />;
    }

    const { unmount } = render(<Component />);
    unmount(); // triggers cleanup which throws

    expect(errSpy).toHaveBeenCalledWith(
      "[supergrain/modifier] cleanup threw:",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  it("skips re-setup when the callback ref is invoked again with the same element (line 135)", () => {
    const setupSpy = vi.fn();
    const cleanupSpy = vi.fn();

    const m = modifier<HTMLDivElement, []>((el) => {
      setupSpy(el);
      return () => cleanupSpy();
    });

    let capturedCallback: ((el: HTMLDivElement | null) => void) | null = null;

    function Component() {
      const cb = useModifier(m);
      capturedCallback = cb;
      return <div ref={cb} data-testid="el" />;
    }

    const { getByTestId } = render(<Component />);
    expect(setupSpy).toHaveBeenCalledTimes(1);
    const el = getByTestId("el") as HTMLDivElement;

    // Manually call the callback ref with the same element a second time.
    // elementRef.current === el → early return at line 135 (no teardown, no re-setup).
    act(() => {
      capturedCallback!(el);
    });

    expect(setupSpy).toHaveBeenCalledTimes(1); // NOT re-called
    expect(cleanupSpy).toHaveBeenCalledTimes(0); // cleanup NOT triggered
  });
});
