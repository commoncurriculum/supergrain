import { createStore } from "@supergrain/core";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect } from "vitest";

import { tracked } from "../src";

describe("tracked()", () => {
  it("returns a component that provides access to store values", () => {
    const store = createStore({ title: "hello" });

    const TestComponent = tracked(() => {
      return <div data-testid="title">{store.title}</div>;
    });

    render(<TestComponent />);
    expect(screen.getByTestId("title").textContent).toBe("hello");
  });

  it("re-renders when tracked signal changes", () => {
    const store = createStore({ title: "hello" });
    let renderCount = 0;

    const TestComponent = tracked(() => {
      renderCount++;
      const title = store.title;
      return <div data-testid="title">{title}</div>;
    });

    render(<TestComponent />);
    expect(screen.getByTestId("title").textContent).toBe("hello");
    expect(renderCount).toBe(1);

    act(() => {
      store.title = "world";
    });

    expect(screen.getByTestId("title").textContent).toBe("world");
    expect(renderCount).toBe(2);
  });

  it("only re-renders for tracked properties", () => {
    const store = createStore({ title: "hello", count: 0 });
    let renderCount = 0;

    const TestComponent = tracked(() => {
      renderCount++;
      const title = store.title;
      return <div data-testid="title">{title}</div>;
    });

    render(<TestComponent />);
    expect(renderCount).toBe(1);

    // Update count (not tracked by this component)
    act(() => {
      store.count = 42;
    });

    // Should NOT re-render
    expect(renderCount).toBe(1);

    // Update title (tracked)
    act(() => {
      store.title = "world";
    });

    // Should re-render
    expect(renderCount).toBe(2);
  });
});
