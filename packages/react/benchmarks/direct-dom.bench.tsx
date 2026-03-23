/**
 * React adapter benchmark: supergrain proxy vs direct-dom vs React hooks vs Solid.js
 *
 * - proxy: tracked() + For — standard React integration
 * - direct-dom: cloneNode + @supergrain/core/internal signal wiring, no React rows
 * - react hooks: vanilla React with useState/memo (no external store)
 * - solid-js: SolidJS store with imperative DOM
 *
 * Each benchmark validates its results to ensure operations actually
 * produce the expected DOM output — no fake results.
 *
 * Run: cd packages/react && pnpm bench
 */

import { createStore, effect } from "@supergrain/core";
import { $NODE, $RAW } from "@supergrain/core/internal";
import { render, cleanup, act } from "@testing-library/react";
import React, { FC, memo, useCallback, useState, useRef, useEffect } from "react";
import {
  createRoot as createSolidRoot,
  createEffect as createSolidEffect,
  createSignal,
  batch as solidBatch,
} from "solid-js";
import { createStore as createSolidStore } from "solid-js/store";
import { bench, describe, assert } from "vitest";

import { tracked, For } from "../src";

// --- Types & data ---
interface RowData {
  id: number;
  label: string;
}
interface AppState {
  data: RowData[];
  selected: number | null;
}

let idCounter = 1;
const adj = [
  "pretty",
  "large",
  "big",
  "small",
  "tall",
  "short",
  "long",
  "handsome",
  "plain",
  "quaint",
];
const col = [
  "red",
  "yellow",
  "blue",
  "green",
  "pink",
  "brown",
  "purple",
  "white",
  "black",
  "orange",
];
const nou = [
  "table",
  "chair",
  "house",
  "bbq",
  "desk",
  "car",
  "pony",
  "cookie",
  "sandwich",
  "burger",
];
const rnd = (max: number) => Math.round(Math.random() * 1000) % max;

function buildData(count: number): RowData[] {
  const d: RowData[] = new Array(count);
  for (let i = 0; i < count; i++) {
    d[i] = {
      id: idCounter++,
      label: `${adj[rnd(adj.length)]} ${col[rnd(col.length)]} ${nou[rnd(nou.length)]}`,
    };
  }
  return d;
}

// Row template for Solid.js (cloned, not rendered by React)
const rowTemplate = document.createElement("tr");
rowTemplate.innerHTML = `<td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td>`;

// --- Validation helpers ---
function assertRowCount(container: HTMLElement, expected: number, label: string) {
  const rows = container.querySelectorAll("tbody tr");
  assert(rows.length === expected, `${label}: expected ${expected} rows, got ${rows.length}`);
}

function assertRowText(
  container: HTMLElement,
  rowIndex: number,
  tdIndex: number,
  expected: string,
  label: string,
) {
  const td = container.querySelector(
    `tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${tdIndex + 1})`,
  );
  assert(
    td?.textContent === expected,
    `${label}: expected "${expected}" at row ${rowIndex} td ${tdIndex}, got "${td?.textContent}"`,
  );
}

function assertRowClass(container: HTMLElement, rowIndex: number, expected: string, label: string) {
  const tr = container.querySelector(`tbody tr:nth-child(${rowIndex + 1})`);
  assert(
    tr?.className === expected,
    `${label}: expected class "${expected}" on row ${rowIndex}, got "${tr?.className}"`,
  );
}

// --- Proxy App (supergrain + React) ---
const Row = tracked(
  ({
    item,
    isSelected,
    onSelect,
    onRemove,
  }: {
    item: RowData;
    isSelected: boolean;
    onSelect: (id: number) => void;
    onRemove: (id: number) => void;
  }) => (
    <tr className={isSelected ? "danger" : ""}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4">
        <a onClick={() => onSelect(item.id)}>{item.label}</a>
      </td>
      <td className="col-md-1">
        <a onClick={() => onRemove(item.id)}>
          <span className="glyphicon glyphicon-remove" />
        </a>
      </td>
      <td className="col-md-6"></td>
    </tr>
  ),
);

const ProxyApp = tracked(
  ({ store, sel, rem }: { store: any; sel: (id: number) => void; rem: (id: number) => void }) => {
    const selected = store.selected;
    const hs = useCallback((id: number) => sel(id), []);
    const hr = useCallback((id: number) => rem(id), []);
    return (
      <table>
        <tbody>
          <For each={store.data}>
            {(item: RowData) => (
              <Row
                key={item.id}
                item={item}
                isSelected={selected === item.id}
                onSelect={hs}
                onRemove={hr}
              />
            )}
          </For>
        </tbody>
      </table>
    );
  },
);

// --- Direct DOM App: cloneNode + signal wiring, no React rows ---
// Uses @supergrain/core/internal APIs to wire signals directly to DOM.
const DirectDomApp: FC<{ store: any; sel: (id: number) => void; rem: (id: number) => void }> = ({
  store,
  sel,
  rem,
}) => {
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const stateRef = useRef<{ cleanups: (() => void)[]; raw: any; storeNodes: any } | null>(null);

  if (!stateRef.current) {
    const raw = (store as any)[$RAW] || store;
    stateRef.current = { cleanups: [], raw, storeNodes: raw[$NODE] };
  }

  const st = stateRef.current;
  (store as any).__directBuild = (data: RowData[]) => {
    const tbody = tbodyRef.current!;
    const storeNodes = st.storeNodes;
    st.raw.data = data;

    for (const c of st.cleanups) c();
    st.cleanups = [];
    tbody.textContent = "";

    for (const item of data) {
      const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement;
      const tds = tr.children;
      (tds[0] as HTMLElement).textContent = String(item.id);
      const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement;
      const a2 = (tds[2] as HTMLElement).firstChild as HTMLAnchorElement;

      a1.textContent = item.label;
      a1.onclick = () => sel(item.id);
      a2.onclick = () => rem(item.id);

      const itemNodes = (item as any)[$NODE];
      if (itemNodes?.label) {
        st.cleanups.push(
          effect(() => {
            a1.textContent = itemNodes.label();
          }),
        );
      }
      if (storeNodes?.selected) {
        const itemId = item.id;
        st.cleanups.push(
          effect(() => {
            tr.className = storeNodes.selected() === itemId ? "danger" : "";
          }),
        );
      }

      tbody.appendChild(tr);
    }
  };

  useEffect(() => {
    return () => {
      for (const c of st.cleanups) c();
    };
  }, []);

  return (
    <table>
      <tbody ref={tbodyRef} />
    </table>
  );
};

function makeStore() {
  const [store, upd] = createStore<AppState>({ data: [], selected: null });
  return {
    store,
    upd,
    run: (n: number) => {
      store.data = buildData(n);
      store.selected = null;
    },
    sel: (id: number) => {
      store.selected = id;
    },
    rem: (id: number) => {
      upd({ $pull: { data: { id } } });
    },
    update10th: () => {
      for (let i = 0; i < store.data.length; i += 10) store.data[i].label += " !!!";
    },
    swap: () => {
      if (store.data.length > 998) {
        const a = store.data[1],
          b = store.data[998];
        store.data[1] = b;
        store.data[998] = a;
      }
    },
  };
}

// --- React Hooks App (vanilla React, no external store) ---
const HooksRow: FC<{
  item: RowData;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onRemove: (id: number) => void;
}> = memo(({ item, isSelected, onSelect, onRemove }) => (
  <tr className={isSelected ? "danger" : ""}>
    <td className="col-md-1">{item.id}</td>
    <td className="col-md-4">
      <a onClick={() => onSelect(item.id)}>{item.label}</a>
    </td>
    <td className="col-md-1">
      <a onClick={() => onRemove(item.id)}>
        <span className="glyphicon glyphicon-remove" />
      </a>
    </td>
    <td className="col-md-6"></td>
  </tr>
));

function makeHooksApp() {
  let setData: React.Dispatch<React.SetStateAction<RowData[]>>;
  let setSelected: React.Dispatch<React.SetStateAction<number | null>>;
  let getData: () => RowData[];

  const HooksApp: FC = () => {
    const [data, sd] = useState<RowData[]>([]);
    const [selected, ss] = useState<number | null>(null);
    setData = sd;
    setSelected = ss;
    const dataRef = useRef(data);
    dataRef.current = data;
    getData = () => dataRef.current;

    const hs = useCallback((id: number) => ss(id), []);
    const hr = useCallback((id: number) => sd((d) => d.filter((r) => r.id !== id)), []);

    return (
      <table>
        <tbody>
          {data.map((item) => (
            <HooksRow
              key={item.id}
              item={item}
              isSelected={selected === item.id}
              onSelect={hs}
              onRemove={hr}
            />
          ))}
        </tbody>
      </table>
    );
  };

  return {
    HooksApp,
    run: (n: number) => {
      setData(buildData(n));
      setSelected(null);
    },
    sel: (id: number) => {
      setSelected(id);
    },
    update10th: () => {
      setData((d) =>
        d.map((item, i) => (i % 10 === 0 ? { ...item, label: item.label + " !!!" } : item)),
      );
    },
    swap: () => {
      setData((d) => {
        if (d.length <= 998) return d;
        const next = [...d];
        const t = next[1];
        next[1] = next[998];
        next[998] = t;
        return next;
      });
    },
  };
}

// --- Solid.js implementation (imperative DOM) ---
function makeSolidBench() {
  let dispose: (() => void) | null = null;
  let container: HTMLElement | null = null;
  let _setStore: any;
  let _store: any;
  let _setDataLen: ((n: number) => void) | null = null;

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);

    createSolidRoot((d) => {
      dispose = d;
      const [s, ss] = createSolidStore<{ data: RowData[]; selected: number | null }>({
        data: [],
        selected: null,
      });
      _store = s;
      _setStore = ss;

      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      table.appendChild(tbody);
      container!.appendChild(table);

      const [dataLen, setDataLen] = createSignal(0);
      _setDataLen = setDataLen;
      let rowCleanups: (() => void)[] = [];

      createSolidEffect(() => {
        const len = dataLen();
        for (const c of rowCleanups) c();
        rowCleanups = [];
        tbody.textContent = "";

        for (let idx = 0; idx < len; idx++) {
          const item = s.data[idx];
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement;
          const tds = tr.children;
          const td0 = tds[0] as HTMLElement;
          const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement;

          td0.textContent = String(item.id);
          a1.textContent = item.label;

          const itemId = item.id;
          a1.onclick = () => ss("selected", itemId);

          const capturedIdx = idx;
          createSolidRoot((dRow) => {
            rowCleanups.push(dRow);
            createSolidEffect(() => {
              a1.textContent = s.data[capturedIdx].label;
            });
            createSolidEffect(() => {
              tr.className = s.selected === itemId ? "danger" : "";
            });
          });

          tbody.appendChild(tr);
        }
      });
    });
  }

  function unmount() {
    if (dispose) dispose();
    if (container) {
      container.remove();
      container = null;
    }
    dispose = null;
    _setDataLen = null;
  }

  return {
    mount,
    unmount,
    getContainer: () => container,
    run: (n: number) => {
      const data = buildData(n);
      solidBatch(() => {
        _setStore("data", data);
        _setStore("selected", null);
      });
      _setDataLen!(data.length);
    },
    sel: (id: number) => {
      _setStore("selected", id);
    },
    update10th: () => {
      solidBatch(() => {
        for (let i = 0; i < _store.data.length; i += 10) {
          _setStore("data", i, "label", (l: string) => l + " !!!");
        }
      });
    },
    swap: () => {
      if (_store.data.length > 998) {
        solidBatch(() => {
          const a = { ..._store.data[1] };
          const b = { ..._store.data[998] };
          _setStore("data", 1, b);
          _setStore("data", 998, a);
        });
      }
    },
  };
}

// --- Benchmarks ---

describe("Create 1000 rows", () => {
  bench("proxy", async () => {
    const ctx = makeStore();
    const { container } = render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      ctx.run(1000);
    });
    assertRowCount(container, 1000, "proxy create");
    cleanup();
    idCounter = 1;
  });
  bench("direct-dom", async () => {
    const ctx = makeStore();
    const { container } = render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      (ctx.store as any).__directBuild(buildData(1000));
    });
    assertRowCount(container, 1000, "direct-dom create");
    cleanup();
    idCounter = 1;
  });
  bench("react hooks", async () => {
    const ctx = makeHooksApp();
    const { container } = render(<ctx.HooksApp />);
    await act(async () => {
      ctx.run(1000);
    });
    assertRowCount(container, 1000, "hooks create");
    cleanup();
    idCounter = 1;
  });
  bench("solid-js", () => {
    const ctx = makeSolidBench();
    ctx.mount();
    ctx.run(1000);
    assertRowCount(ctx.getContainer()!, 1000, "solid create");
    ctx.unmount();
    idCounter = 1;
  });
});

describe("Select row", () => {
  bench("proxy", async () => {
    const ctx = makeStore();
    const { container } = render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.sel(500);
    });
    assertRowClass(container, 499, "danger", "proxy select");
    assertRowClass(container, 498, "", "proxy select neighbor");
    cleanup();
    idCounter = 1;
  });
  bench("direct-dom", async () => {
    const ctx = makeStore();
    const { container } = render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      (ctx.store as any).__directBuild(buildData(1000));
    });
    await act(async () => {
      ctx.sel(500);
    });
    assertRowClass(container, 499, "danger", "direct-dom select");
    cleanup();
    idCounter = 1;
  });
  bench("react hooks", async () => {
    const ctx = makeHooksApp();
    const { container } = render(<ctx.HooksApp />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.sel(500);
    });
    assertRowClass(container, 499, "danger", "hooks select");
    cleanup();
    idCounter = 1;
  });
  bench("solid-js", () => {
    const ctx = makeSolidBench();
    ctx.mount();
    ctx.run(1000);
    ctx.sel(500);
    assertRowClass(ctx.getContainer()!, 499, "danger", "solid select");
    ctx.unmount();
    idCounter = 1;
  });
});

describe("Swap rows", () => {
  bench("proxy", async () => {
    const ctx = makeStore();
    const { container } = render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      ctx.run(1000);
    });
    const id1Before = container.querySelector("tbody tr:nth-child(2) td")!.textContent;
    const id998Before = container.querySelector("tbody tr:nth-child(999) td")!.textContent;
    await act(async () => {
      ctx.swap();
    });
    assertRowText(container, 1, 0, id998Before!, "proxy swap row 1");
    assertRowText(container, 998, 0, id1Before!, "proxy swap row 998");
    cleanup();
    idCounter = 1;
  });
  bench("direct-dom", async () => {
    const ctx = makeStore();
    const { container } = render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      (ctx.store as any).__directBuild(buildData(1000));
    });
    const id1Before = container.querySelector("tbody tr:nth-child(2) td")!.textContent;
    const id998Before = container.querySelector("tbody tr:nth-child(999) td")!.textContent;
    await act(async () => {
      ctx.swap();
    });
    assertRowText(container, 1, 0, id998Before!, "direct-dom swap row 1");
    assertRowText(container, 998, 0, id1Before!, "direct-dom swap row 998");
    cleanup();
    idCounter = 1;
  });
  bench("react hooks", async () => {
    const ctx = makeHooksApp();
    const { container } = render(<ctx.HooksApp />);
    await act(async () => {
      ctx.run(1000);
    });
    const id1Before = container.querySelector("tbody tr:nth-child(2) td")!.textContent;
    const id998Before = container.querySelector("tbody tr:nth-child(999) td")!.textContent;
    await act(async () => {
      ctx.swap();
    });
    assertRowText(container, 1, 0, id998Before!, "hooks swap row 1");
    assertRowText(container, 998, 0, id1Before!, "hooks swap row 998");
    cleanup();
    idCounter = 1;
  });
  bench("solid-js", () => {
    const ctx = makeSolidBench();
    ctx.mount();
    ctx.run(1000);
    const c = ctx.getContainer()!;
    const id1Before = c.querySelector("tbody tr:nth-child(2) td")!.textContent;
    const id998Before = c.querySelector("tbody tr:nth-child(999) td")!.textContent;
    ctx.swap();
    assertRowText(c, 1, 0, id998Before!, "solid swap row 1");
    assertRowText(c, 998, 0, id1Before!, "solid swap row 998");
    ctx.unmount();
    idCounter = 1;
  });
});

describe("Partial update (100 of 1000)", () => {
  bench("proxy", async () => {
    const ctx = makeStore();
    const { container } = render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.update10th();
    });
    const firstRowLabel =
      container.querySelector("tbody tr:nth-child(1) td:nth-child(2) a")?.textContent ?? "";
    assert(
      firstRowLabel.endsWith(" !!!"),
      `proxy update: first row should end with " !!!", got "${firstRowLabel}"`,
    );
    cleanup();
    idCounter = 1;
  });
  bench("direct-dom", async () => {
    const ctx = makeStore();
    const { container } = render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      (ctx.store as any).__directBuild(buildData(1000));
    });
    await act(async () => {
      ctx.update10th();
    });
    const firstRowLabel =
      container.querySelector("tbody tr:nth-child(1) td:nth-child(2) a")?.textContent ?? "";
    assert(
      firstRowLabel.endsWith(" !!!"),
      `direct-dom update: first row should end with " !!!", got "${firstRowLabel}"`,
    );
    cleanup();
    idCounter = 1;
  });
  bench("react hooks", async () => {
    const ctx = makeHooksApp();
    const { container } = render(<ctx.HooksApp />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.update10th();
    });
    const firstRowLabel =
      container.querySelector("tbody tr:nth-child(1) td:nth-child(2) a")?.textContent ?? "";
    assert(
      firstRowLabel.endsWith(" !!!"),
      `hooks update: first row should end with " !!!", got "${firstRowLabel}"`,
    );
    cleanup();
    idCounter = 1;
  });
  bench("solid-js", () => {
    const ctx = makeSolidBench();
    ctx.mount();
    ctx.run(1000);
    ctx.update10th();
    const c = ctx.getContainer()!;
    const firstRowLabel =
      c.querySelector("tbody tr:nth-child(1) td:nth-child(2) a")?.textContent ?? "";
    assert(
      firstRowLabel.endsWith(" !!!"),
      `solid update: first row should end with " !!!", got "${firstRowLabel}"`,
    );
    ctx.unmount();
    idCounter = 1;
  });
});
