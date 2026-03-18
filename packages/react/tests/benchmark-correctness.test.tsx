/**
 * Verify that all benchmark implementations actually produce correct DOM.
 * This ensures benchmark numbers reflect real work, not no-ops.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  createStore,
  effect,
  getCurrentSub,
  setCurrentSub,
  signal as coreSignal,
} from "@supergrain/core";
import { $NODE, $RAW } from "@supergrain/core/internal";
import { tracked, For } from "../src";
import React, {
  FC,
  memo,
  useCallback,
  useReducer,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { render, cleanup, act } from "@testing-library/react";
import {
  createRoot as createSolidRoot,
  createEffect as createSolidEffect,
  createSignal,
  batch as solidBatch,
} from "solid-js";
import { createStore as createSolidStore } from "solid-js/store";

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

// --- Row template (same as benchmark) ---
const rowTemplate = document.createElement("tr");
rowTemplate.innerHTML = `<td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td>`;

// Ensure $NODE map exists and has signals for all own keys
function ensureNodes(raw: any) {
  let nodes = raw[$NODE];
  if (!nodes) {
    Object.defineProperty(raw, $NODE, { value: {}, enumerable: false, configurable: true });
    nodes = raw[$NODE];
  }
  for (const key of Object.keys(raw)) {
    if (!nodes[key]) nodes[key] = coreSignal(raw[key]);
  }
  return nodes;
}

// --- Shared helpers ---
function useReactiveEffect() {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const stateRef = useRef<{ cleanup: (() => void) | null; effectNode: any } | null>(null);
  if (!stateRef.current) {
    let effectNode: any = null;
    let isFirstRun = true;
    const c = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub();
        isFirstRun = false;
        return;
      }
      forceUpdate();
    });
    stateRef.current = { cleanup: c, effectNode };
  }
  const prevSub = getCurrentSub();
  setCurrentSub(stateRef.current.effectNode);
  useLayoutEffect(() => {
    setCurrentSub(prevSub);
  });
  useEffect(() => {
    return () => {
      stateRef.current?.cleanup?.();
    };
  }, []);
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

describe("Direct DOM (supergrain $$) correctness", () => {
  const DirectDomApp: FC<{ store: any }> = ({ store }) => {
    const tbodyRef = useRef<HTMLTableSectionElement>(null);
    const cleanups = useRef<(() => void)[]>([]);

    useEffect(() => {
      const raw = (store as any)[$RAW] || store;
      const storeNodes = ensureNodes(raw);

      const dataCleanup = effect(() => {
        const data: RowData[] = storeNodes.data();
        const tbody = tbodyRef.current!;
        for (const c of cleanups.current) c();
        cleanups.current = [];
        tbody.textContent = "";

        for (const item of data) {
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement;
          const tds = tr.children;
          (tds[0] as HTMLElement).textContent = String(item.id);
          const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement;
          a1.textContent = item.label;

          const itemNodes = ensureNodes(item);
          if (itemNodes?.label) {
            const c = effect(() => {
              a1.textContent = itemNodes.label();
            });
            cleanups.current.push(c);
          }
          if (storeNodes?.selected) {
            const itemId = item.id;
            const c = effect(() => {
              tr.className = storeNodes.selected() === itemId ? "danger" : "";
            });
            cleanups.current.push(c);
          }
          tbody.appendChild(tr);
        }
      });

      return () => {
        dataCleanup();
        for (const c of cleanups.current) c();
      };
    }, []);

    return (
      <table>
        <tbody ref={tbodyRef} />
      </table>
    );
  };

  it("renders rows correctly", async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null });
    const { container } = render(<DirectDomApp store={store} />);
    await act(async () => {}); // let effects run
    const tbody = container.querySelector("tbody")!;
    const rows = getRowsFromTbody(tbody);
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe("1");
    expect(rows[0].label).toBe("red table");
    expect(rows[1].label).toBe("blue chair");
  });

  it("updates label reactively", async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null });
    const { container } = render(<DirectDomApp store={store} />);
    await act(async () => {}); // let effects run
    await act(async () => {
      store.data[0].label = "updated label";
    });
    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows[0].label).toBe("updated label");
  });

  it("selects row reactively", async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null });
    const { container } = render(<DirectDomApp store={store} />);
    await act(async () => {}); // let effects run
    await act(async () => {
      store.selected = 2;
    });
    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows[0].className).toBe("");
    expect(rows[1].className).toBe("danger");
  });
});

describe("Solid-js correctness", () => {
  it("renders rows correctly", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    let dispose: () => void;
    createSolidRoot((d) => {
      dispose = d;
      const [s, ss] = createSolidStore<AppState>({ data: testData(), selected: null });

      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      table.appendChild(tbody);
      container.appendChild(table);

      createSolidEffect(() => {
        tbody.textContent = "";
        for (const item of s.data) {
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement;
          const tds = tr.children;
          (tds[0] as HTMLElement).textContent = String(item.id);
          ((tds[1] as HTMLElement).firstChild as HTMLAnchorElement).textContent = item.label;
          tbody.appendChild(tr);
        }
      });
    });

    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe("1");
    expect(rows[0].label).toBe("red table");
    expect(rows[1].label).toBe("blue chair");

    dispose!();
    container.remove();
  });

  it("updates label reactively", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    let dispose: () => void;
    let setStore: any;

    createSolidRoot((d) => {
      dispose = d;
      const [s, ss] = createSolidStore<AppState>({ data: testData(), selected: null });
      setStore = ss;

      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      table.appendChild(tbody);
      container.appendChild(table);

      createSolidEffect(() => {
        tbody.textContent = "";
        for (let i = 0; i < s.data.length; i++) {
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement;
          const tds = tr.children;
          (tds[0] as HTMLElement).textContent = String(s.data[i].id);
          const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement;
          createSolidRoot(() => {
            createSolidEffect(() => {
              a1.textContent = s.data[i].label;
            });
          });
          tbody.appendChild(tr);
        }
      });
    });

    setStore("data", 0, "label", "updated label");
    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows[0].label).toBe("updated label");

    dispose!();
    container.remove();
  });

  it("selects row reactively", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    let dispose: () => void;
    let setStore: any;

    createSolidRoot((d) => {
      dispose = d;
      const [s, ss] = createSolidStore<AppState>({ data: testData(), selected: null });
      setStore = ss;

      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      table.appendChild(tbody);
      container.appendChild(table);

      createSolidEffect(() => {
        tbody.textContent = "";
        for (const item of s.data) {
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement;
          const tds = tr.children;
          (tds[0] as HTMLElement).textContent = String(item.id);
          ((tds[1] as HTMLElement).firstChild as HTMLAnchorElement).textContent = item.label;
          const itemId = item.id;
          createSolidRoot(() => {
            createSolidEffect(() => {
              tr.className = s.selected === itemId ? "danger" : "";
            });
          });
          tbody.appendChild(tr);
        }
      });
    });

    setStore("selected", 2);
    const rows = getRowsFromTbody(container.querySelector("tbody")!);
    expect(rows[0].className).toBe("");
    expect(rows[1].className).toBe("danger");

    dispose!();
    container.remove();
  });
});
