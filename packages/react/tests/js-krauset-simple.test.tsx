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

  it("label update re-renders only the affected row, not parent or siblings", async () => {
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

    const Row = tracked(
      ({
        item,
        isSelected,
        onSelect,
      }: {
        item: any;
        isSelected: boolean;
        onSelect: (id: number) => void;
      }) => {
        if (item.id === 1) row1RenderCount++;
        if (item.id === 2) row2RenderCount++;
        if (item.id === 3) row3RenderCount++;

        return (
          <div data-testid={`row-${item.id}`} className={isSelected ? "danger" : ""}>
            <span onClick={() => onSelect(item.id)}>{item.label}</span>
          </div>
        );
      },
    );

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

    expect(parentRenderCount).toBe(1);
    expect(row1RenderCount).toBe(1);
    expect(row2RenderCount).toBe(1);
    expect(row3RenderCount).toBe(1);

    // Update only row 1's label
    await act(async () => {
      updateStore({ $set: { "data.0.label": `${store.data[0].label} !!!` } });
      await flushMicrotasks();
    });

    // Parent uses For, so it should NOT re-render on element property change
    expect(parentRenderCount).toBe(1);
    // Only row 1 should re-render
    expect(row1RenderCount).toBe(2);
    expect(row2RenderCount).toBe(1);
    expect(row3RenderCount).toBe(1);
  });

  it("selection change re-renders parent and all rows (props change via isSelected)", async () => {
    const [store, updateStore] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
      selected: null as number | null,
    });

    let parentRenderCount = 0;

    const Row = tracked(({ item, isSelected }: { item: any; isSelected: boolean }) => {
      return (
        <div className={isSelected ? "danger" : ""}>
          <span>{item.label}</span>
        </div>
      );
    });

    const RowList = tracked(() => {
      parentRenderCount++;
      const selected = store.selected;
      return (
        <div>
          <For each={store.data}>
            {(item: any) => <Row key={item.id} item={item} isSelected={selected === item.id} />}
          </For>
        </div>
      );
    });

    render(<RowList />);
    expect(parentRenderCount).toBe(1);

    await act(async () => {
      updateStore({ $set: { selected: 1 } });
      await flushMicrotasks();
    });

    // Parent re-renders because it reads store.selected
    expect(parentRenderCount).toBe(2);
  });

  it("without For, parent re-renders on element property change (map iterates in parent scope)", async () => {
    const [store, updateStore] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    let parentRenderCount = 0;
    let row1RenderCount = 0;
    let row2RenderCount = 0;

    const Row = tracked(({ item }: { item: any }) => {
      if (item.id === 1) row1RenderCount++;
      if (item.id === 2) row2RenderCount++;
      return <div>{item.label}</div>;
    });

    const DirectRowList = tracked(() => {
      parentRenderCount++;
      return (
        <div>
          {store.data.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </div>
      );
    });

    render(<DirectRowList />);
    expect(parentRenderCount).toBe(1);

    await act(async () => {
      updateStore({ $set: { "data.0.label": "Updated Item 1" } });
      await flushMicrotasks();
    });

    // Parent iterates via .map() but only reads item.id (for key), not item.label.
    // So a label change doesn't trigger the parent — only the Row that reads label re-renders.
    expect(parentRenderCount).toBe(1);
    expect(row1RenderCount).toBe(2);
    expect(row2RenderCount).toBe(1);
  });

  it("component reading only array length does not re-render on element property change", async () => {
    const [store, updateStore] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    let renderCount = 0;

    const LengthOnly = tracked(() => {
      renderCount++;
      return <div>Items: {store.data.length}</div>;
    });

    render(<LengthOnly />);
    expect(renderCount).toBe(1);

    await act(async () => {
      updateStore({ $set: { "data.0.label": `${store.data[0].label} !!!` } });
      await flushMicrotasks();
    });

    // Only reads length, not element properties — should NOT re-render
    expect(renderCount).toBe(1);
  });
});
