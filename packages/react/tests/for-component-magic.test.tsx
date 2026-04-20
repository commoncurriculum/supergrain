import {
  createReactive,
  startBatch,
  endBatch,
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
  update,
} from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { tracked, For } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("For Component Magic Tests", () => {
  beforeEach(() => {
    cleanup();
    enableProfiling();
    resetProfiler();
  });

  afterEach(() => {
    disableProfiling();
  });

  it("should test if For component enables array element subscriptions", async () => {
    const store = createReactive({
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
      update(store, { $set: { "data.0.label": "Updated Item 1" } });
      await flushMicrotasks();
    });
  });

  it("should test what exactly For component does differently", async () => {
    const store = createReactive({
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
      update(store, { $set: { "data.0.label": "Updated!" } });
      await flushMicrotasks();
    });
  });

  it("push on empty array triggers For re-render (fresh store)", async () => {
    const store = createReactive<{ data: { id: number; label: string }[] }>({ data: [] });

    const App = tracked(() => (
      <ul>
        <For each={store.data}>
          {(item: { id: number; label: string }) => <li key={item.id}>{item.label}</li>}
        </For>
      </ul>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("li").length).toBe(0);

    await act(async () => {
      store.data.push({ id: 1, label: "first" }, { id: 2, label: "second" });
    });

    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelectorAll("li")[0].textContent).toBe("first");
  });

  it("splice on array triggers For re-render (fresh store, no prior assignment)", async () => {
    const store = createReactive<{ items: string[] }>({ items: ["a", "b", "c"] });

    const App = tracked(() => (
      <ul>
        <For each={store.items}>{(item: string, i: number) => <li key={i}>{item}</li>}</For>
      </ul>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("li").length).toBe(3);

    await act(async () => {
      store.items.splice(1, 1); // remove "b"
    });

    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("a");
    expect(items[1].textContent).toBe("c");
  });

  it("swap only re-renders the 2 swapped rows, not all rows", async () => {
    interface RowData {
      id: number;
      label: string;
    }

    const store = createReactive<{ data: RowData[] }>({
      data: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        label: `Item ${i + 1}`,
      })),
    });

    const renderedIds = new Set<number>();

    const Row = tracked(({ item }: { item: RowData }) => {
      renderedIds.add(item.id);
      return (
        <tr>
          <td>{item.id}</td>
          <td>{item.label}</td>
        </tr>
      );
    });

    const App = tracked(() => (
      <table>
        <tbody>
          <For each={store.data}>{(item: RowData) => <Row key={item.id} item={item} />}</For>
        </tbody>
      </table>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("tr").length).toBe(20);

    // Reset after initial render
    renderedIds.clear();

    // Swap indices 1 and 18 (batched)
    await act(async () => {
      startBatch();
      const tmp = store.data[1]!;
      store.data[1] = store.data[18]!;
      store.data[18] = tmp;
      endBatch();
    });

    // Verify the swap happened in the DOM
    const rows = container.querySelectorAll("tr");
    expect(rows[1]!.querySelector("td")!.textContent).toBe("19"); // was 2
    expect(rows[18]!.querySelector("td")!.textContent).toBe("2"); // was 19

    // For re-renders on swap (per-index signals) with correct keys so React
    // moves DOM nodes. Only the 2 moved ForItems re-render.
    expect(renderedIds.size).toBeLessThanOrEqual(2);
  });

  it("swap: For re-renders with correct keys, but only swapped Rows re-render", async () => {
    interface RowData {
      id: number;
      label: string;
    }

    const store = createReactive<{ data: RowData[] }>({
      data: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        label: `Item ${i + 1}`,
      })),
    });

    const renderedIds = new Set<number>();

    const Row = tracked(({ item }: { item: RowData }) => {
      renderedIds.add(item.id);
      return (
        <tr>
          <td>{item.id}</td>
          <td>{item.label}</td>
        </tr>
      );
    });

    const App = tracked(() => (
      <table>
        <tbody>
          <For each={store.data}>{(item: RowData) => <Row key={item.id} item={item} />}</For>
        </tbody>
      </table>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("tr").length).toBe(20);
    renderedIds.clear();

    // Swap indices 1 and 18 (batched)
    await act(async () => {
      startBatch();
      const tmp = store.data[1]!;
      store.data[1] = store.data[18]!;
      store.data[18] = tmp;
      endBatch();
    });

    // Verify the swap happened in the DOM
    const rows = container.querySelectorAll("tr");
    expect(rows[1]!.querySelector("td")!.textContent).toBe("19");
    expect(rows[18]!.querySelector("td")!.textContent).toBe("2");

    // For re-renders (per-index signals) with correct keys. React moves
    // ForItems by key. ForItem memo passes for unmoved items. Only moved
    // ForItems re-render; Row memo passes for those (same proxy identity).
    expect(renderedIds.size).toBeLessThanOrEqual(2);
  });

  it("For keys by item.id: DOM nodes are reused after remove", async () => {
    interface RowData {
      id: number;
      label: string;
    }

    const store = createReactive<{ data: RowData[] }>({
      data: [
        { id: 10, label: "A" },
        { id: 20, label: "B" },
        { id: 30, label: "C" },
        { id: 40, label: "D" },
      ],
    });

    const mountedIds: number[] = [];
    const unmountedIds: number[] = [];

    const Row = tracked(({ item }: { item: RowData }) => {
      React.useEffect(() => {
        mountedIds.push(item.id);
        return () => {
          unmountedIds.push(item.id);
        };
      }, [item.id]);
      return <li data-id={item.id}>{item.label}</li>;
    });

    const App = tracked(() => (
      <ul>
        <For each={store.data}>{(item: RowData) => <Row key={item.id} item={item} />}</For>
      </ul>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("li").length).toBe(4);
    mountedIds.length = 0;

    // Remove item at index 1 (id=20)
    await act(async () => {
      store.data.splice(1, 1);
    });

    expect(container.querySelectorAll("li").length).toBe(3);
    // Item 20 should be unmounted, no other items remounted
    expect(unmountedIds).toContain(20);
    // Items 10, 30, 40 should NOT have been remounted
    expect(mountedIds).not.toContain(10);
    expect(mountedIds).not.toContain(30);
    expect(mountedIds).not.toContain(40);
  });

  it("For keys by item.id: swap then remove reconciles correctly", async () => {
    interface RowData {
      id: number;
      label: string;
    }

    const store = createReactive<{ data: RowData[] }>({
      data: [
        { id: 1, label: "A" },
        { id: 2, label: "B" },
        { id: 3, label: "C" },
        { id: 4, label: "D" },
        { id: 5, label: "E" },
      ],
    });

    const App = tracked(() => (
      <ul>
        <For each={store.data}>{(item: RowData) => <li data-id={item.id}>{item.label}</li>}</For>
      </ul>
    ));

    const { container } = render(<App />);

    // Swap indices 1 and 3 (B and D) — For does NOT re-render
    await act(async () => {
      startBatch();
      const tmp = store.data[1]!;
      store.data[1] = store.data[3]!;
      store.data[3] = tmp;
      endBatch();
    });

    // Verify swap: [A, D, C, B, E]
    let items = container.querySelectorAll("li");
    expect(items[1]!.textContent).toBe("D");
    expect(items[3]!.textContent).toBe("B");

    // Now remove index 2 (C) — For re-renders with fresh keys
    await act(async () => {
      store.data.splice(2, 1);
    });

    // Should be [A, D, B, E] with correct content
    items = container.querySelectorAll("li");
    expect(items.length).toBe(4);
    expect(items[0]!.textContent).toBe("A");
    expect(items[1]!.textContent).toBe("D");
    expect(items[2]!.textContent).toBe("B");
    expect(items[3]!.textContent).toBe("E");
  });

  it("partial update: only updated rows re-render, not For or other rows", async () => {
    interface RowData {
      id: number;
      label: string;
    }

    const store = createReactive<{ data: RowData[] }>({
      data: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        label: `Item ${i + 1}`,
      })),
    });

    let forChildrenCalls = 0;
    const renderedIds = new Set<number>();

    const Row = tracked(({ item }: { item: RowData }) => {
      renderedIds.add(item.id);
      return (
        <tr>
          <td>{item.id}</td>
          <td>{item.label}</td>
        </tr>
      );
    });

    const App = tracked(() => (
      <table>
        <tbody>
          <For each={store.data}>
            {(item: RowData) => {
              forChildrenCalls++;
              return <Row key={item.id} item={item} />;
            }}
          </For>
        </tbody>
      </table>
    ));

    render(<App />);
    forChildrenCalls = 0;
    renderedIds.clear();
    resetProfiler();

    // Update every 10th row's label (indices 0 and 10)
    await act(async () => {
      startBatch();
      store.data[0]!.label += " !!!";
      store.data[10]!.label += " !!!";
      endBatch();
    });

    const p = getProfile();

    // For's children function should NOT be called (no structural change)
    expect(forChildrenCalls).toBe(0);
    // Only the 2 updated rows should re-render
    expect(renderedIds.size).toBe(2);
    expect(renderedIds.has(1)).toBe(true);
    expect(renderedIds.has(11)).toBe(true);

    // Signal-level assertions: catch over-subscription
    expect(p.signalWrites).toBe(2); // 2 label changes
    // Mutation path reads should all be skips (no subscriber)
    expect(p.signalSkips).toBeGreaterThan(0);
  });

  it("select: only previously-selected and newly-selected rows re-render", async () => {
    interface RowData {
      id: number;
      label: string;
    }

    const store = createReactive<{
      data: RowData[];
      selected: number | null;
    }>({
      data: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        label: `Item ${i + 1}`,
      })),
      selected: null,
    });

    const renderedIds = new Set<number>();

    const Row = tracked(({ item, isSelected }: { item: RowData; isSelected: boolean }) => {
      renderedIds.add(item.id);
      return (
        <tr className={isSelected ? "danger" : ""}>
          <td>{item.id}</td>
        </tr>
      );
    });

    const App = tracked(() => {
      const selected = store.selected;
      return (
        <table>
          <tbody>
            <For each={store.data}>
              {(item: RowData) => (
                <Row key={item.id} item={item} isSelected={selected === item.id} />
              )}
            </For>
          </tbody>
        </table>
      );
    });

    render(<App />);
    renderedIds.clear();
    resetProfiler();

    // Select row 5
    await act(async () => {
      store.selected = 5;
    });

    const p = getProfile();

    // Only the newly selected row should re-render (at most 1 new + 0 old deselected)
    expect(renderedIds.size).toBe(1);
    if (renderedIds.size > 0) {
      expect(renderedIds.has(5)).toBe(true);
    }

    // Signal-level: store.selected change triggers App re-render,
    // which re-creates all Row JSX, but memo skips unchanged rows.
    expect(p.signalWrites).toBe(1); // only store.selected
  });

  it("select change: at most old + new selected rows re-render", async () => {
    interface RowData {
      id: number;
      label: string;
    }

    const store = createReactive<{
      data: RowData[];
      selected: number | null;
    }>({
      data: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        label: `Item ${i + 1}`,
      })),
      selected: 5,
    });

    const renderedIds = new Set<number>();

    const Row = tracked(({ item, isSelected }: { item: RowData; isSelected: boolean }) => {
      renderedIds.add(item.id);
      return (
        <tr className={isSelected ? "danger" : ""}>
          <td>{item.id}</td>
        </tr>
      );
    });

    const App = tracked(() => {
      const selected = store.selected;
      return (
        <table>
          <tbody>
            <For each={store.data}>
              {(item: RowData) => (
                <Row key={item.id} item={item} isSelected={selected === item.id} />
              )}
            </For>
          </tbody>
        </table>
      );
    });

    render(<App />);
    renderedIds.clear();
    resetProfiler();

    // Change selection from 5 to 10
    await act(async () => {
      store.selected = 10;
    });

    const p = getProfile();

    // At most the old selected (5) and new selected (10) should re-render
    expect(renderedIds.size).toBe(2);

    // Signal-level profiling
    expect(p.signalWrites).toBe(1); // only store.selected
  });

  it("append: For re-renders, existing rows do NOT re-render", async () => {
    interface RowData {
      id: number;
      label: string;
    }

    const store = createReactive<{ data: RowData[] }>({
      data: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        label: `Item ${i + 1}`,
      })),
    });

    let forChildrenCalls = 0;
    const renderedIds = new Set<number>();

    const Row = tracked(({ item }: { item: RowData }) => {
      renderedIds.add(item.id);
      return (
        <li>
          {item.id}: {item.label}
        </li>
      );
    });

    const App = tracked(() => (
      <ul>
        <For each={store.data}>
          {(item: RowData) => {
            forChildrenCalls++;
            return <Row key={item.id} item={item} />;
          }}
        </For>
      </ul>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("li").length).toBe(5);
    forChildrenCalls = 0;
    renderedIds.clear();

    // Append 3 new items
    await act(async () => {
      store.data.push(
        { id: 6, label: "Item 6" },
        { id: 7, label: "Item 7" },
        { id: 8, label: "Item 8" },
      );
    });

    expect(container.querySelectorAll("li").length).toBe(8);
    // For re-renders and calls children for all 8 (structural change)
    // But only the 3 NEW rows should actually render — existing 5 are memo'd
    expect(renderedIds.size).toBe(3);
    expect(renderedIds.has(6)).toBe(true);
    expect(renderedIds.has(7)).toBe(true);
    expect(renderedIds.has(8)).toBe(true);
  });

  it("remove: For re-renders, remaining rows do NOT re-render", async () => {
    interface RowData {
      id: number;
      label: string;
    }

    const store = createReactive<{ data: RowData[] }>({
      data: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        label: `Item ${i + 1}`,
      })),
    });

    const renderedIds = new Set<number>();

    const Row = tracked(({ item }: { item: RowData }) => {
      renderedIds.add(item.id);
      return <li>{item.label}</li>;
    });

    const App = tracked(() => (
      <ul>
        <For each={store.data}>{(item: RowData) => <Row key={item.id} item={item} />}</For>
      </ul>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("li").length).toBe(10);
    renderedIds.clear();

    // Remove item at index 3 (id=4)
    await act(async () => {
      store.data.splice(3, 1);
    });

    expect(container.querySelectorAll("li").length).toBe(9);
    // Remaining rows should NOT re-render (only structural change)
    // Some ForItems get new index props, but their children function
    // produces same Row elements (same item proxy) → memo skips
    expect(renderedIds.size).toBe(0);
  });

  it("push after initial empty render without any prior store.data assignment", async () => {
    // This is the exact scenario that broke the production benchmark:
    // 1. Fresh store with empty array
    // 2. Component renders (empty)
    // 3. First mutation is push (not assignment)
    const store = createReactive<{ data: { id: number }[] }>({ data: [] });

    const App = tracked(() => (
      <For each={store.data}>{(item: { id: number }) => <span key={item.id}>{item.id}</span>}</For>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("span").length).toBe(0);

    // First mutation is push — no prior store.data = [...] assignment
    await act(async () => {
      store.data.push({ id: 1 });
    });

    expect(container.querySelectorAll("span").length).toBe(1);
    expect(container.querySelector("span")!.textContent).toBe("1");
  });

  describe("parent prop: stale fiber stress tests", () => {
    interface RowData {
      id: number;
      label: string;
    }

    function createTestStore(count: number) {
      return createReactive<{ data: RowData[]; selected: number | null }>({
        data: Array.from({ length: count }, (_, i) => ({
          id: i + 1,
          label: `Item ${i + 1}`,
        })),
        selected: null,
      });
    }

    // Parent path requires tracked children for reactive property updates.
    const StressRow = tracked(({ item }: { item: RowData }) => {
      return (
        <tr>
          <td>{item.id}</td>
          <td>{item.label}</td>
        </tr>
      );
    });

    function getLabels(c: HTMLElement) {
      return Array.from(c.querySelectorAll("tr")).map(
        (tr) => tr.querySelectorAll("td")[1]?.textContent ?? "",
      );
    }

    function getIds(c: HTMLElement) {
      return Array.from(c.querySelectorAll("tr")).map(
        (tr) => tr.querySelectorAll("td")[0]?.textContent ?? "",
      );
    }

    it("swap then update label on swapped item", async () => {
      const store = createTestStore(5);

      const App = tracked(() => {
        const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
        return (
          <table>
            <tbody ref={tbodyRef}>
              <For each={store.data} parent={tbodyRef}>
                {(item: RowData) => <StressRow key={item.id} item={item} />}
              </For>
            </tbody>
          </table>
        );
      });

      const { container } = render(<App />);
      expect(getIds(container)).toEqual(["1", "2", "3", "4", "5"]);

      // Swap indices 1 and 3 (items 2 and 4)
      await act(async () => {
        startBatch();
        const tmp = store.data[1]!;
        store.data[1] = store.data[3]!;
        store.data[3] = tmp;
        endBatch();
      });

      expect(getIds(container)).toEqual(["1", "4", "3", "2", "5"]);

      // Now update the label on item 2 (now at position 3)
      await act(async () => {
        store.data[3]!.label = "UPDATED";
      });

      // Item 2 is at position 3 — its label should be updated there
      expect(getLabels(container)[3]).toBe("UPDATED");
      // Other items unchanged
      expect(getLabels(container)[1]).toBe("Item 4");
    });

    it("swap then update label on NON-swapped item", async () => {
      const store = createTestStore(5);

      const App = tracked(() => {
        const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
        return (
          <table>
            <tbody ref={tbodyRef}>
              <For each={store.data} parent={tbodyRef}>
                {(item: RowData) => <StressRow key={item.id} item={item} />}
              </For>
            </tbody>
          </table>
        );
      });

      const { container } = render(<App />);

      // Swap indices 0 and 4
      await act(async () => {
        startBatch();
        const tmp = store.data[0]!;
        store.data[0] = store.data[4]!;
        store.data[4] = tmp;
        endBatch();
      });

      expect(getIds(container)).toEqual(["5", "2", "3", "4", "1"]);

      // Update label on item 3 (index 2, not swapped)
      await act(async () => {
        store.data[2]!.label = "MIDDLE UPDATED";
      });

      expect(getLabels(container)[2]).toBe("MIDDLE UPDATED");
      // Swapped items still correct
      expect(getIds(container)).toEqual(["5", "2", "3", "4", "1"]);
    });

    it("swap then remove a swapped item", async () => {
      const store = createTestStore(5);

      const App = tracked(() => {
        const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
        return (
          <table>
            <tbody ref={tbodyRef}>
              <For each={store.data} parent={tbodyRef}>
                {(item: RowData) => <StressRow key={item.id} item={item} />}
              </For>
            </tbody>
          </table>
        );
      });

      const { container } = render(<App />);

      // Swap indices 1 and 3
      await act(async () => {
        startBatch();
        const tmp = store.data[1]!;
        store.data[1] = store.data[3]!;
        store.data[3] = tmp;
        endBatch();
      });

      expect(getIds(container)).toEqual(["1", "4", "3", "2", "5"]);

      // Remove the item at index 1 (item 4, which was swapped to this position)
      await act(async () => {
        store.data.splice(1, 1);
      });

      expect(getIds(container)).toEqual(["1", "3", "2", "5"]);
    });

    it("swap then add items", async () => {
      const store = createTestStore(5);

      const App = tracked(() => {
        const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
        return (
          <table>
            <tbody ref={tbodyRef}>
              <For each={store.data} parent={tbodyRef}>
                {(item: RowData) => <StressRow key={item.id} item={item} />}
              </For>
            </tbody>
          </table>
        );
      });

      const { container } = render(<App />);

      // Swap indices 0 and 4
      await act(async () => {
        startBatch();
        const tmp = store.data[0]!;
        store.data[0] = store.data[4]!;
        store.data[4] = tmp;
        endBatch();
      });

      expect(getIds(container)).toEqual(["5", "2", "3", "4", "1"]);

      // Push new items
      await act(async () => {
        store.data.push({ id: 6, label: "Item 6" }, { id: 7, label: "Item 7" });
      });

      expect(getIds(container)).toEqual(["5", "2", "3", "4", "1", "6", "7"]);
    });

    it("multiple swaps in a row", async () => {
      const store = createTestStore(5);

      const App = tracked(() => {
        const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
        return (
          <table>
            <tbody ref={tbodyRef}>
              <For each={store.data} parent={tbodyRef}>
                {(item: RowData) => <StressRow key={item.id} item={item} />}
              </For>
            </tbody>
          </table>
        );
      });

      const { container } = render(<App />);

      // Swap 0 and 4
      await act(async () => {
        startBatch();
        const tmp = store.data[0]!;
        store.data[0] = store.data[4]!;
        store.data[4] = tmp;
        endBatch();
      });

      expect(getIds(container)).toEqual(["5", "2", "3", "4", "1"]);

      // Swap 1 and 3
      await act(async () => {
        startBatch();
        const tmp = store.data[1]!;
        store.data[1] = store.data[3]!;
        store.data[3] = tmp;
        endBatch();
      });

      expect(getIds(container)).toEqual(["5", "4", "3", "2", "1"]);

      // Swap back 0 and 4
      await act(async () => {
        startBatch();
        const tmp = store.data[0]!;
        store.data[0] = store.data[4]!;
        store.data[4] = tmp;
        endBatch();
      });

      expect(getIds(container)).toEqual(["1", "4", "3", "2", "5"]);
    });

    it("swap then select a swapped item", async () => {
      const store = createTestStore(5);

      const SelectableRow = tracked(({ item }: { item: RowData }) => {
        return (
          <tr className={store.selected === item.id ? "danger" : ""}>
            <td>{item.id}</td>
            <td>{item.label}</td>
          </tr>
        );
      });

      const App = tracked(() => {
        const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
        return (
          <table>
            <tbody ref={tbodyRef}>
              <For each={store.data} parent={tbodyRef}>
                {(item: RowData) => <SelectableRow key={item.id} item={item} />}
              </For>
            </tbody>
          </table>
        );
      });

      const { container } = render(<App />);

      // Swap indices 1 and 3
      await act(async () => {
        startBatch();
        const tmp = store.data[1]!;
        store.data[1] = store.data[3]!;
        store.data[3] = tmp;
        endBatch();
      });

      expect(getIds(container)).toEqual(["1", "4", "3", "2", "5"]);

      // Select item 4 (now at position 1 after swap)
      await act(async () => {
        store.selected = 4;
      });

      const rows = container.querySelectorAll("tr");
      // Item 4 is at position 1 — it should have "danger" class
      expect(rows[1]!.className).toBe("danger");
      // Others should not
      expect(rows[0]!.className).toBe("");
      expect(rows[2]!.className).toBe("");
      expect(rows[3]!.className).toBe("");
      expect(rows[4]!.className).toBe("");
    });
  });
});
