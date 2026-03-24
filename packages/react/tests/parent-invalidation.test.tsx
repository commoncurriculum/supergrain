import {
  createStore,
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
  update,
} from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { tracked, update } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("Parent Invalidation Depth Tests", () => {
  beforeEach(() => {
    cleanup();
    enableProfiling();
    resetProfiler();
  });

  afterEach(() => {
    disableProfiling();
  });

  it("should test how many levels of parent invalidation occur", async () => {
    // Create deeply nested structure
    const store = createStore({
      level0: {
        level1: {
          level2: {
            level3: {
              level4: {
                value: "initial",
              },
            },
          },
        },
      },
      array: [
        {
          id: 1,
          nested: {
            deep: {
              value: "array-initial",
            },
          },
        },
      ],
    });

    // Track render counts for components at each level
    let rootRenderCount = 0;
    let level1RenderCount = 0;
    let level2RenderCount = 0;
    let level3RenderCount = 0;
    let level4RenderCount = 0;
    let arrayRenderCount = 0;
    let arrayItemRenderCount = 0;

    // Component that accesses root level
    const RootComponent = tracked(() => {
      rootRenderCount++;
      // Access the root level0 property
      const _ = store.level0;
      return <div data-testid="root">Root: {rootRenderCount}</div>;
    });

    // Component that accesses level1
    const Level1Component = tracked(() => {
      level1RenderCount++;
      const _ = store.level0.level1;
      return <div data-testid="level1">Level1: {level1RenderCount}</div>;
    });

    // Component that accesses level2
    const Level2Component = tracked(() => {
      level2RenderCount++;
      const _ = store.level0.level1.level2;
      return <div data-testid="level2">Level2: {level2RenderCount}</div>;
    });

    // Component that accesses level3
    const Level3Component = tracked(() => {
      level3RenderCount++;
      const _ = store.level0.level1.level2.level3;
      return <div data-testid="level3">Level3: {level3RenderCount}</div>;
    });

    // Component that accesses level4
    const Level4Component = tracked(() => {
      level4RenderCount++;
      const _ = store.level0?.level1?.level2?.level3?.level4;
      return <div data-testid="level4">Level4: {level4RenderCount}</div>;
    });

    // Component that accesses array
    const ArrayComponent = tracked(() => {
      arrayRenderCount++;
      const _ = store.array;
      return <div data-testid="array">Array: {arrayRenderCount}</div>;
    });

    // Component that accesses array item
    const ArrayItemComponent = tracked(() => {
      arrayItemRenderCount++;
      const _ = store.array[0];
      return <div data-testid="array-item">ArrayItem: {arrayItemRenderCount}</div>;
    });

    function TestApp() {
      return (
        <div>
          <RootComponent />
          <Level1Component />
          <Level2Component />
          <Level3Component />
          <Level4Component />
          <ArrayComponent />
          <ArrayItemComponent />
        </div>
      );
    }

    render(<TestApp />);

    // Initial render - all components render once
    expect(rootRenderCount).toBe(1);
    expect(level1RenderCount).toBe(1);
    expect(level2RenderCount).toBe(1);
    expect(level3RenderCount).toBe(1);
    expect(level4RenderCount).toBe(1);
    expect(arrayRenderCount).toBe(1);
    expect(arrayItemRenderCount).toBe(1);

    // Test 1: Update deeply nested object property
    await act(async () => {
      update(store, {
        $set: {
          "level0.level1.level2.level3.level4.value": "updated-deep",
        },
      });
      await flushMicrotasks();
    });

    // Updating level4.value should NOT re-render components that only access
    // higher levels (root, level1, level2, level3). Only level4 accesses the
    // leaf object, so only it may re-render.
    expect(rootRenderCount).toBe(1); // root only accessed level0 — unchanged
    expect(level1RenderCount).toBe(1); // level1 only accessed level1 — unchanged
    expect(level2RenderCount).toBe(1); // level2 only accessed level2 — unchanged
    expect(level3RenderCount).toBe(1); // level3 only accessed level3 — unchanged
    // level4 accessed level4 OBJECT but not .value — should NOT re-render
    expect(level4RenderCount).toBe(1);
    expect(arrayRenderCount).toBe(1); // array untouched
    expect(arrayItemRenderCount).toBe(1); // array item untouched

    // Test 2: Update array nested property — only arrayItem should re-render
    const arrayBefore = arrayRenderCount;
    const arrayItemBefore = arrayItemRenderCount;
    await act(async () => {
      update(store, {
        $set: {
          "array.0.nested.deep.value": "updated-array-deep",
        },
      });
      await flushMicrotasks();
    });
    expect(rootRenderCount).toBe(1); // still untouched
    expect(arrayRenderCount).toBe(arrayBefore); // array ref unchanged
    // arrayItem accesses array[0] OBJECT but not nested.deep.value — should NOT re-render
    expect(arrayItemRenderCount).toBe(arrayItemBefore);

    // Test 3: Update intermediate level directly — replaces level2 object
    const level2Before = level2RenderCount;
    const level3Before = level3RenderCount;
    const level4Before = level4RenderCount;
    await act(async () => {
      update(store, {
        $set: {
          "level0.level1.level2": { newProp: "direct-update" },
        },
      });
      await flushMicrotasks();
    });
    // level2 accessed level2 which was replaced → should re-render exactly once
    expect(level2RenderCount).toBe(level2Before + 1);
  });

  it("should test array-specific parent invalidation behavior", async () => {
    const store = createStore({
      items: [
        {
          id: 1,
          name: "Item 1",
          details: { description: "First item", meta: { tag: "A" } },
        },
        {
          id: 2,
          name: "Item 2",
          details: { description: "Second item", meta: { tag: "B" } },
        },
      ],
    });

    let arrayAccessRenderCount = 0;
    let itemAccessRenderCount = 0;
    let detailsAccessRenderCount = 0;

    // Component that accesses the array
    const ArrayAccessComponent = tracked(() => {
      arrayAccessRenderCount++;
      const _ = store.items;
      return <div>Array access: {arrayAccessRenderCount}</div>;
    });

    // Component that accesses first array item
    const ItemAccessComponent = tracked(() => {
      itemAccessRenderCount++;
      const _ = store.items[0];
      return <div>Item access: {itemAccessRenderCount}</div>;
    });

    // Component that accesses nested property in array item
    const DetailsAccessComponent = tracked(() => {
      detailsAccessRenderCount++;
      const _ = store.items[0].details;
      return <div>Details access: {detailsAccessRenderCount}</div>;
    });

    function ArrayTestApp() {
      return (
        <div>
          <ArrayAccessComponent />
          <ItemAccessComponent />
          <DetailsAccessComponent />
        </div>
      );
    }

    render(<ArrayTestApp />);

    // Initial render
    expect(arrayAccessRenderCount).toBe(1);
    expect(itemAccessRenderCount).toBe(1);
    expect(detailsAccessRenderCount).toBe(1);

    // Update deeply nested property in array item
    await act(async () => {
      update(store, {
        $set: {
          "items.0.details.meta.tag": "UPDATED",
        },
      });
      await flushMicrotasks();
    });

    // Updating a deeply nested property in array[0].details.meta should NOT
    // re-render components that only access higher levels
    expect(arrayAccessRenderCount).toBe(1); // array ref unchanged
    // itemAccess reads items[0] — the object at index 0 didn't change identity
    expect(itemAccessRenderCount).toBe(1);
    // detailsAccess reads items[0].details — details object didn't change identity
    expect(detailsAccessRenderCount).toBe(1);
  });
});
