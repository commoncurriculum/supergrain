/**
 * Verify that the proxy (React) benchmark implementation produces correct DOM.
 * This ensures benchmark numbers reflect real work, not no-ops.
 */

import { createStore } from "@supergrain/core";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, afterEach } from "vitest";

import { tracked, For } from "../src";

// --- Shared data ---
interface RowData {
  id: number;
  label: string;
}
interface AppState {
  data: RowData[];
  selected: number | null;
}

function testData(): RowData[] {
  return [
    { id: 1, label: "red table" },
    { id: 2, label: "blue chair" },
    { id: 3, label: "green house" },
  ];
}

// --- Helper to extract row data from a tbody ---
function getRowsFromTbody(tbody: HTMLElement): { id: string; label: string; className: string }[] {
  const rows: { id: string; label: string; className: string }[] = [];
  const trs = tbody.querySelectorAll("tr");
  for (const tr of trs) {
    const tds = tr.querySelectorAll("td");
    const id = tds[0]?.textContent ?? "";
    const a = tds[1]?.querySelector("a");
    const label = a?.textContent ?? "";
    rows.push({ id, label, className: tr.className });
  }
  return rows;
}

afterEach(() => cleanup());

describe("Proxy (React) correctness", () => {
  const Row = tracked(({ item, isSelected }: { item: RowData; isSelected: boolean }) => (
    <tr className={isSelected ? "danger" : ""}>
      <td>{item.id}</td>
      <td>
        <a>{item.label}</a>
      </td>
    </tr>
  ));

  const App = tracked(({ store }: { store: AppState }) => {
    const selected = store.selected;
    // Iterate data in App's tracked scope so array mutations trigger re-render
    const data = store.data;
    return (
      <table>
        <tbody data-testid="tbody">
          {data.map((item: RowData) => (
            <Row key={item.id} item={item} isSelected={selected === item.id} />
          ))}
        </tbody>
      </table>
    );
  });

  it("renders rows correctly", async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null });
    const { container } = render(<App store={store} />);
    const tbody = container.querySelector("tbody")!;
    const rows = getRowsFromTbody(tbody);
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe("1");
    expect(rows[0].label).toBe("red table");
    expect(rows[1].label).toBe("blue chair");
  });

  it("updates label reactively", async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null });
    const { container } = render(<App store={store} />);
    await act(async () => {
      store.data[0].label = "updated label";
    });
    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows[0].label).toBe("updated label");
  });

  it("selects row reactively", async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null });
    const { container } = render(<App store={store} />);
    await act(async () => {
      store.selected = 2;
    });
    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows[0].className).toBe("");
    expect(rows[1].className).toBe("danger");
  });

  it("swaps rows correctly", async () => {
    const data = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` }));
    const [store] = createStore<AppState>({ data, selected: null });
    const { container } = render(<App store={store} />);

    await act(async () => {
      const a = store.data[1];
      const b = store.data[998];
      store.data[1] = b;
      store.data[998] = a;
    });

    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows[1].id).toBe("999");
    expect(rows[998].id).toBe("2");
    expect(rows[0].id).toBe("1");
    expect(rows[999].id).toBe("1000");
  });

  it("removes row via splice", async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null });
    const { container } = render(<App store={store} />);

    await act(async () => {
      const index = store.data.findIndex((item: any) => item.id === 2);
      store.data.splice(index, 1);
    });

    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("1");
    expect(rows[1].id).toBe("3");
  });

  it("appends rows via push", async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null });
    const { container } = render(<App store={store} />);

    await act(async () => {
      store.data.push(
        ...Array.from({ length: 3 }, (_, i) => ({ id: 10 + i, label: `new ${10 + i}` })),
      );
    });

    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows).toHaveLength(6);
    expect(rows[3].id).toBe("10");
    expect(rows[5].id).toBe("12");
  });

  it("clears all rows", async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null });
    const { container } = render(<App store={store} />);
    expect(getRowsFromTbody(container.querySelector("tbody")!)).toHaveLength(3);

    await act(async () => {
      store.data = [];
      store.selected = null;
    });

    expect(getRowsFromTbody(container.querySelector("tbody")!)).toHaveLength(0);
  });

  it("partial update modifies every 10th row", async () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` }));
    const [store] = createStore<AppState>({ data, selected: null });
    const { container } = render(<App store={store} />);

    await act(async () => {
      for (let i = 0; i < store.data.length; i += 10) {
        store.data[i].label = store.data[i].label + " !!!";
      }
    });

    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows[0].label).toBe("item 1 !!!");
    expect(rows[1].label).toBe("item 2");
    expect(rows[10].label).toBe("item 11 !!!");
  });
});
