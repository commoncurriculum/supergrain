import { createStore } from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { tracked, For } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("For Component Magic Tests", () => {
  beforeEach(() => {
    cleanup();
  });

  it("should test if For component enables array element subscriptions", async () => {
    const [store, update] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    let withForRenderCount = 0;
    let withoutForRenderCount = 0;

    // Component that uses For
    const WithForComponent = tracked(() => {
      withForRenderCount++;

      return (
        <div>
          <For each={store.data}>{(item: any) => <div key={item.id}>{item.label}</div>}</For>
        </div>
      );
    });

    // Component that uses regular map
    const WithoutForComponent = tracked(() => {
      withoutForRenderCount++;

      return (
        <div>
          {store.data.map((item: any) => (
            <div key={item.id}>{item.label}</div>
          ))}
        </div>
      );
    });

    function TestApp() {
      return (
        <div>
          <WithForComponent />
          <WithoutForComponent />
        </div>
      );
    }

    render(<TestApp />);

    // Test: Update data.0.label
    await act(async () => {
      update({ $set: { "data.0.label": "Updated Item 1" } });
      await flushMicrotasks();
    });
  });

  it("should test what exactly For component does differently", async () => {
    const [store, update] = createStore({
      data: [{ id: 1, label: "Item 1" }],
    });

    let renderCount = 0;

    const TestComponent = tracked(() => {
      renderCount++;

      const result = store.data.map((item) => {
        return <div key={item.id}>{item.label}</div>;
      });

      return <div>{result}</div>;
    });

    render(<TestComponent />);

    await act(async () => {
      update({ $set: { "data.0.label": "Updated!" } });
      await flushMicrotasks();
    });
  });
});
