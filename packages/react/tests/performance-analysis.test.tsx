import { createStore } from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { describe, it, expect, afterEach } from "vitest";

import { tracked, For } from "../src";

/**
 * Performance Analysis Tests
 *
 * This suite analyzes the rendering behavior for common scenarios:
 * 1. Selecting a row.
 * 2. Partially updating a row.
 */

// --- Data Generation ---
interface RowData {
  id: number;
  label: string;
}

const buildData = (count: number): RowData[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    label: `Item ${i + 1}`,
  }));
};

interface AppState {
  data: RowData[];
  selected: number | null;
}

// --- Render Tracking ---
let _renderCount = 0;
let renderedRowIds = new Set<number>();

const resetRenderTracking = () => {
  _renderCount = 0;
  renderedRowIds.clear();
};

// --- Components ---

const TrackingRow = tracked(({ item, isSelected }: { item: RowData; isSelected: boolean }) => {
  _renderCount++;
  renderedRowIds.add(item.id);

  return (
    <tr className={isSelected ? "danger" : ""}>
      <td>{item.id}</td>
      <td>
        <a>{item.label}</a>
      </td>
    </tr>
  );
});

const App = tracked(({ store }: { store: any }) => {
  const selected = store.selected;

  return (
    <table>
      <tbody>
        <For each={store.data}>
          {(row: RowData) => (
            <TrackingRow key={row.id} item={row} isSelected={row.id === selected} />
          )}
        </For>
      </tbody>
    </table>
  );
});

describe("Performance Analysis", () => {
  afterEach(() => {
    cleanup();
    resetRenderTracking();
  });

  it("should only re-render the selected and previously selected rows when selecting a row", () => {
    const data = buildData(100);
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    });

    render(<App store={store} />);
    resetRenderTracking();

    // Select row 25
    act(() => {
      updateStore({ $set: { selected: data[24].id } });
    });

    // The parent component re-renders, and the <For> component will re-render the row
    // because the isSelected prop changes.
    expect(renderedRowIds.size).toBe(1);
    expect(renderedRowIds.has(25)).toBe(true);

    resetRenderTracking();

    // Select row 50
    act(() => {
      updateStore({ $set: { selected: data[49].id } });
    });

    // The previously selected row (25) and the new one (50) should re-render
    expect(renderedRowIds.size).toBe(2);
    expect(renderedRowIds.has(25)).toBe(true);
    expect(renderedRowIds.has(50)).toBe(true);
  });

  it("should only re-render the updated row on a partial update", () => {
    const data = buildData(100);
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    });

    render(<App store={store} />);
    resetRenderTracking();

    // Update the label of row 42
    act(() => {
      updateStore({ $set: { "data.41.label": "Updated Label" } });
    });

    // Only the updated row should re-render
    expect(renderedRowIds.size).toBe(1);
    expect(renderedRowIds.has(42)).toBe(true);
  });
});
