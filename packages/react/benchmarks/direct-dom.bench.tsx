/**
 * Direct DOM benchmark: Solid-style template cloning within React.
 *
 * React renders the outer container. Rows are created via cloneNode +
 * direct signal subscriptions — no React components, no VDOM, no memo.
 *
 * Run: cd packages/react && npx vitest bench --config vitest.bench.config.ts benchmarks/direct-dom.bench.tsx
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
import { bench, describe } from "vitest";

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

// --- Row template (cloned, not rendered by React) ---
const rowTemplate = document.createElement("tr");
rowTemplate.innerHTML = `<td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td>`;

// --- Proxy App (baseline — standard React) ---
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
// Builds rows synchronously (no reactive data-watching effect).
// Per-row effects handle label + selection updates directly.
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

  // Expose a build function that the benchmark calls directly
  const st = stateRef.current;
  (store as any).__directBuild = (data: RowData[]) => {
    const tbody = tbodyRef.current!;
    const storeNodes = st.storeNodes;
    // Set store data for operations that need it (sel, swap, update)
    st.raw.data = data;

    // Tear down old
    for (const c of st.cleanups) c();
    st.cleanups = [];
    tbody.textContent = "";

    // Build rows synchronously — no outer effect, no reactive context overhead
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
    // Store a getter via ref so operations can read current data
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

// --- Solid.js implementation (imperative DOM, no JSX) ---
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

      // Use a signal to trigger full rebuilds when data array is replaced
      const [dataLen, setDataLen] = createSignal(0);
      _setDataLen = setDataLen;
      let rowCleanups: (() => void)[] = [];

      createSolidEffect(() => {
        const len = dataLen();
        // Tear down old row effects
        for (const c of rowCleanups) c();
        rowCleanups = [];
        tbody.textContent = "";

        for (let idx = 0; idx < len; idx++) {
          const item = s.data[idx];
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement;
          const tds = tr.children;
          const td0 = tds[0] as HTMLElement;
          const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement;
          const a2 = (tds[2] as HTMLElement).firstChild as HTMLAnchorElement;

          td0.textContent = String(item.id);
          a1.textContent = item.label;

          const itemId = item.id;
          a1.onclick = () => ss("selected", itemId);
          a2.onclick = () => {}; // no-op for bench

          // Fine-grained: track label at this index via store proxy
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
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      ctx.run(1000);
    });
    cleanup();
    idCounter = 1;
  });
  bench("direct-dom $$", async () => {
    const ctx = makeStore();
    render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      (ctx.store as any).__directBuild(buildData(1000));
      cleanup();
    });
    idCounter = 1;
  });
  bench("react hooks", async () => {
    const ctx = makeHooksApp();
    render(<ctx.HooksApp />);
    await act(async () => {
      ctx.run(1000);
    });
    cleanup();
    idCounter = 1;
  });
  bench("solid-js", () => {
    const ctx = makeSolidBench();
    ctx.mount();
    ctx.run(1000);
    ctx.unmount();
    idCounter = 1;
  });
});

describe("Select row", () => {
  bench("proxy", async () => {
    const ctx = makeStore();
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.sel(500);
    });
    cleanup();
    idCounter = 1;
  });
  bench("direct-dom $$", async () => {
    const ctx = makeStore();
    render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      (ctx.store as any).__directBuild(buildData(1000));
    });
    await act(async () => {
      ctx.sel(500);
      cleanup();
    });
    idCounter = 1;
  });
  bench("react hooks", async () => {
    const ctx = makeHooksApp();
    render(<ctx.HooksApp />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.sel(500);
    });
    cleanup();
    idCounter = 1;
  });
  bench("solid-js", () => {
    const ctx = makeSolidBench();
    ctx.mount();
    ctx.run(1000);
    ctx.sel(500);
    ctx.unmount();
    idCounter = 1;
  });
});

describe("Swap rows", () => {
  bench("proxy", async () => {
    const ctx = makeStore();
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.swap();
    });
    cleanup();
    idCounter = 1;
  });
  bench("direct-dom $$", async () => {
    const ctx = makeStore();
    render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      (ctx.store as any).__directBuild(buildData(1000));
    });
    await act(async () => {
      ctx.swap();
      cleanup();
    });
    idCounter = 1;
  });
  bench("react hooks", async () => {
    const ctx = makeHooksApp();
    render(<ctx.HooksApp />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.swap();
    });
    cleanup();
    idCounter = 1;
  });
  bench("solid-js", () => {
    const ctx = makeSolidBench();
    ctx.mount();
    ctx.run(1000);
    ctx.swap();
    ctx.unmount();
    idCounter = 1;
  });
});

describe("Partial update (100 of 1000)", () => {
  bench("proxy", async () => {
    const ctx = makeStore();
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.update10th();
    });
    cleanup();
    idCounter = 1;
  });
  bench("direct-dom $$", async () => {
    const ctx = makeStore();
    render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />);
    await act(async () => {
      (ctx.store as any).__directBuild(buildData(1000));
    });
    await act(async () => {
      ctx.update10th();
      cleanup();
    });
    idCounter = 1;
  });
  bench("react hooks", async () => {
    const ctx = makeHooksApp();
    render(<ctx.HooksApp />);
    await act(async () => {
      ctx.run(1000);
    });
    await act(async () => {
      ctx.update10th();
    });
    cleanup();
    idCounter = 1;
  });
  bench("solid-js", () => {
    const ctx = makeSolidBench();
    ctx.mount();
    ctx.run(1000);
    ctx.update10th();
    ctx.unmount();
    idCounter = 1;
  });
});
