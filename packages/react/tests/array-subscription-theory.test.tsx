import { createStore } from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { tracked } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("Array Subscription Theory Tests", () => {
  beforeEach(() => {
    cleanup();
  });

  it("array-length-only component does not re-render on element property change", async () => {
    const [store, update] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    let renderCount = 0;

    const ArrayLengthOnly = tracked(() => {
      renderCount++;
      return <div>Array length: {store.data.length}</div>;
    });

    render(<ArrayLengthOnly />);
    expect(renderCount).toBe(1);

    await act(async () => {
      update({ $set: { "data.0.label": "Updated" } });
      await flushMicrotasks();
    });

    expect(renderCount).toBe(1);
  });

  it("iterating component only re-renders for properties it actually reads", async () => {
    const [store, update] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    let renderCount = 0;

    // Reads item.id but NOT item.label
    const IteratingComponent = tracked(() => {
      renderCount++;
      const ids = store.data.map((item) => item.id);
      return <div>IDs: {ids.join(",")}</div>;
    });

    render(<IteratingComponent />);
    expect(renderCount).toBe(1);

    // Updating label should NOT re-render (component only reads id)
    await act(async () => {
      update({ $set: { "data.0.label": "Updated 1" } });
      await flushMicrotasks();
    });

    expect(renderCount).toBe(1);
  });

  it("specific-element component re-renders only for that element", async () => {
    const [store, update] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    let renderCount = 0;

    const FirstElementOnly = tracked(() => {
      renderCount++;
      const first = store.data[0];
      return <div>First: {first?.label}</div>;
    });

    render(<FirstElementOnly />);
    expect(renderCount).toBe(1);

    // Update data[0] — should re-render
    await act(async () => {
      update({ $set: { "data.0.label": "Updated 1" } });
      await flushMicrotasks();
    });

    expect(renderCount).toBe(2);

    // Update data[1] — should NOT re-render (doesn't access data[1])
    await act(async () => {
      update({ $set: { "data.1.label": "Updated 2" } });
      await flushMicrotasks();
    });

    expect(renderCount).toBe(2);
  });
});
