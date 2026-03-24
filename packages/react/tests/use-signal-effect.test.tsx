import { createStore } from "@supergrain/core";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

import { tracked, useSignalEffect } from "../src/index";

afterEach(() => cleanup());

describe("useSignalEffect()", () => {
  it("runs the effect on mount", () => {
    const store = createStore({ count: 0 });
    const spy = vi.fn();

    const App = tracked(() => {
      useSignalEffect(() => {
        spy(store.count);
      });
      return <div />;
    });

    render(<App />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(0);
  });

  it("re-runs when a tracked signal changes", async () => {
    const store = createStore({ count: 0 });
    const spy = vi.fn();

    const App = tracked(() => {
      useSignalEffect(() => {
        spy(store.count);
      });
      return <div />;
    });

    render(<App />);
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.count = 5;
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(5);
  });

  it("cleans up on unmount", async () => {
    const store = createStore({ count: 0 });
    const spy = vi.fn();

    const App = tracked(() => {
      useSignalEffect(() => {
        spy(store.count);
      });
      return <div />;
    });

    const { unmount } = render(<App />);
    expect(spy).toHaveBeenCalledTimes(1);

    unmount();

    // After unmount, signal changes should NOT trigger the effect
    await act(async () => {
      store.count = 99;
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not cause the component to re-render", async () => {
    const store = createStore({ count: 0 });
    let renders = 0;
    const effectSpy = vi.fn();

    const App = tracked(() => {
      renders++;
      useSignalEffect(() => {
        effectSpy(store.count);
      });
      return <div />;
    });

    render(<App />);
    expect(renders).toBe(1);
    expect(effectSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.count = 5;
    });
    // Effect ran again, but component did NOT re-render
    expect(effectSpy).toHaveBeenCalledTimes(2);
    expect(renders).toBe(1);
  });

  it("tracks signals read inside the effect, not during render", async () => {
    const store = createStore({ a: 1, b: 2 });
    const spy = vi.fn();

    const App = tracked(() => {
      // Read store.a during render — should NOT trigger the effect
      const _a = store.a;
      useSignalEffect(() => {
        // Only track store.b inside the effect
        spy(store.b);
      });
      return <div>{_a}</div>;
    });

    render(<App />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(2);

    // Changing b should trigger the effect
    await act(async () => {
      store.b = 20;
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(20);
  });

  it("works with multiple signal effects in the same component", async () => {
    const store = createStore({ x: 0, y: 0 });
    const spyX = vi.fn();
    const spyY = vi.fn();

    const App = tracked(() => {
      useSignalEffect(() => {
        spyX(store.x);
      });
      useSignalEffect(() => {
        spyY(store.y);
      });
      return <div />;
    });

    render(<App />);
    expect(spyX).toHaveBeenCalledTimes(1);
    expect(spyY).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.x = 10;
    });
    expect(spyX).toHaveBeenCalledTimes(2);
    expect(spyY).toHaveBeenCalledTimes(1); // y didn't change
  });
});
