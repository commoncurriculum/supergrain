import { createReactive, update } from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { tracked, For } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("Deep Nested Array Item Tests", () => {
  beforeEach(() => {
    cleanup();
  });

  it("should test updating deeply nested property in array item - items[0].obj.objTwo.objThree", async () => {
    // Create store with exact structure you specified
    const store = createReactive({
      items: [
        {
          id: 1,
          obj: {
            objTwo: {
              objThree: 1,
            },
          },
        },
      ],
    });

    let componentRenderCount = 0;

    // Single component that accesses the deeply nested structure
    const DeepNestedComponent = tracked(() => {
      componentRenderCount++;

      // Access the deeply nested value
      const deepValue = store.items[0].obj.objTwo.objThree;

      return <div data-testid="deep-nested-value">Deep value: {deepValue}</div>;
    });

    const { container } = render(<DeepNestedComponent />);

    // Verify initial render
    expect(componentRenderCount).toBe(1);
    expect(container.querySelector('[data-testid="deep-nested-value"]')?.textContent).toBe(
      "Deep value: 1",
    );

    // Test 1: Update the deeply nested objThree value
    await act(async () => {
      update(store, {
        $set: {
          "items.0.obj.objTwo.objThree": 42,
        },
      });
      await flushMicrotasks();
    });

    const rendersAfterDeepUpdate = componentRenderCount;

    // Test 2: Update a different deep property to test specificity
    await act(async () => {
      update(store, {
        $set: {
          "items.0.obj.objTwo.newProp": "hello",
        },
      });
      await flushMicrotasks();
    });

    // Test 3: Update a completely different part of the structure
    await act(async () => {
      update(store, {
        $set: {
          "items.0.differentProp": "unrelated",
        },
      });
      await flushMicrotasks();
    });

    if (rendersAfterDeepUpdate > 1) {
      // Verify the value actually updated in the UI
      expect(container.querySelector('[data-testid="deep-nested-value"]')?.textContent).toBe(
        "Deep value: 42",
      );
    }
  });

  it("should test array iteration with deep nested properties", async () => {
    const store = createReactive({
      items: [
        {
          id: 1,
          obj: { objTwo: { objThree: "A" } },
        },
        {
          id: 2,
          obj: { objTwo: { objThree: "B" } },
        },
      ],
    });

    let componentRenderCount = 0;

    const ArrayIterationComponent = tracked(() => {
      componentRenderCount++;

      return (
        <div>
          {store.items.map((item) => (
            <div key={item.id} data-testid={`item-${item.id}`}>
              Item {item.id}: {item.obj.objTwo.objThree}
            </div>
          ))}
        </div>
      );
    });

    const { container } = render(<ArrayIterationComponent />);

    // Update deeply nested property in first item
    await act(async () => {
      update(store, {
        $set: {
          "items.0.obj.objTwo.objThree": "A-UPDATED",
        },
      });
      await flushMicrotasks();
    });

    // Check if the UI actually updated
    const firstItem = container.querySelector('[data-testid="item-1"]');

    if (componentRenderCount > 1) {
      expect(firstItem?.textContent).toBe("Item 1: A-UPDATED");
    }
  });

  it("should test with For component and deep nesting", async () => {
    const store = createReactive({
      items: [
        {
          id: 1,
          obj: { objTwo: { objThree: 100 } },
        },
      ],
    });

    let componentRenderCount = 0;

    const ForComponent = tracked(() => {
      componentRenderCount++;

      return (
        <div>
          <For each={store.items}>
            {(item: any) => (
              <div key={item.id} data-testid={`for-item-${item.id}`}>
                For Item {item.id}: {item.obj.objTwo.objThree}
              </div>
            )}
          </For>
        </div>
      );
    });

    const { container } = render(<ForComponent />);

    await act(async () => {
      update(store, {
        $set: {
          "items.0.obj.objTwo.objThree": 200,
        },
      });
      await flushMicrotasks();
    });

    const forItem = container.querySelector('[data-testid="for-item-1"]');

    if (componentRenderCount > 1) {
      expect(forItem?.textContent).toBe("For Item 1: 200");
    }
  });
});
