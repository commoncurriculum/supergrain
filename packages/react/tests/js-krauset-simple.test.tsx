import { createStore } from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React, { useCallback } from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { tracked, For } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("JS-Krauset Simple Case Tests", () => {
  beforeEach(() => {
    cleanup();
  });

  it("should test the exact js-krauset pattern - items[0].label update", async () => {
    // Create store exactly like js-krauset
    const [store, updateStore] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
        { id: 3, label: "Item 3" },
      ],
      selected: null as number | null,
    });

    let parentRenderCount = 0;
    let row1RenderCount = 0;
    let row2RenderCount = 0;
    let row3RenderCount = 0;

    // Row component exactly like js-krauset
    const Row = tracked(
      ({
        item,
        isSelected: _isSelected,
        onSelect,
      }: {
        item: any;
        isSelected: boolean;
        onSelect: (id: number) => void;
      }) => {
        if (item.id === 1) {
          row1RenderCount++;
        }
        if (item.id === 2) {
          row2RenderCount++;
        }
        if (item.id === 3) {
          row3RenderCount++;
        }

        return (
          <div data-testid={`row-${item.id}`}>
            <span onClick={() => onSelect(item.id)}>{item.label}</span>
          </div>
        );
      },
    );

    // Parent component exactly like js-krauset RowList
    const RowList = tracked(() => {
      parentRenderCount++;

      const handleSelect = useCallback((id: number) => {
        updateStore({ $set: { selected: id } });
      }, []);

      const selected = store.selected;

      return (
        <div data-testid="row-list">
          <For each={store.data}>
            {(item: any) => (
              <Row
                key={item.id}
                item={item}
                isSelected={selected === item.id}
                onSelect={handleSelect}
              />
            )}
          </For>
        </div>
      );
    });

    render(<RowList />);

    // Initial render
    expect(parentRenderCount).toBe(1);
    expect(row1RenderCount).toBe(1);
    expect(row2RenderCount).toBe(1);
    expect(row3RenderCount).toBe(1);

    // Test 1: Update item label exactly like js-krauset
    await act(async () => {
      // This is exactly what js-krauset does in the update() function
      const updates: Record<string, string> = {};
      updates["data.0.label"] = `${store.data[0].label} !!!`;

      updateStore({ $set: updates });
      await flushMicrotasks();
    });

    const _parentAfterLabelUpdate = parentRenderCount;

    // Test 2: Update selection (this should definitely trigger re-renders)
    await act(async () => {
      updateStore({ $set: { selected: 1 } });
      await flushMicrotasks();
    });
  });

  it("should test WITHOUT For component - direct mapping", async () => {
    const [store, updateStore] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    let _parentRenderCount = 0;
    let _row1RenderCount = 0;
    let _row2RenderCount = 0;

    const Row = tracked(({ item }: { item: any }) => {
      if (item.id === 1) {
        _row1RenderCount++;
      }
      if (item.id === 2) {
        _row2RenderCount++;
      }

      return <div>{item.label}</div>;
    });

    const DirectRowList = tracked(() => {
      _parentRenderCount++;

      return (
        <div>
          {store.data.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </div>
      );
    });

    render(<DirectRowList />);

    // Update label without For component
    await act(async () => {
      updateStore({ $set: { "data.0.label": "Updated Item 1" } });
      await flushMicrotasks();
    });
  });

  it("should test what happens when we access individual items during update preparation", async () => {
    const [store, updateStore] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    let _parentRenderCount = 0;

    const TestComponent = tracked(() => {
      _parentRenderCount++;

      // Only access the array, not individual items
      return <div>Items: {store.data.length}</div>;
    });

    render(<TestComponent />);

    await act(async () => {
      // This is exactly what js-krauset does - it accesses store.data[0].label
      // BEFORE doing the update
      const currentLabel = store.data[0].label;

      updateStore({
        $set: {
          "data.0.label": `${currentLabel} !!!`,
        },
      });
      await flushMicrotasks();
    });
  });
});
