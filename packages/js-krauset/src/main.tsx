import {
  createReactive,
  batch,
  enableProfiling,
  resetProfiler,
  getProfile,
} from "@supergrain/kernel";
import { tracked, For } from "@supergrain/kernel/react";
import { Profiler, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

// --- Data Generation ---

let idCounter = 1;

/** Reset the ID counter (for testing only). */
export function resetIdCounter() {
  idCounter = 1;
}

const adjectives = [
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
  "clean",
  "elegant",
  "easy",
  "angry",
  "crazy",
  "helpful",
  "mushy",
  "odd",
  "unsightly",
  "adorable",
  "important",
  "inexpensive",
  "cheap",
  "expensive",
  "fancy",
];
const colours = [
  "red",
  "yellow",
  "blue",
  "green",
  "pink",
  "brown",
  "purple",
  "brown",
  "white",
  "black",
  "orange",
];
const nouns = [
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
  "pizza",
  "mouse",
  "keyboard",
];

export function _random(max: number): number {
  return Math.round(Math.random() * 1000) % max;
}

export function buildData(count: number): RowData[] {
  const data: RowData[] = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idCounter++,
      label: `${adjectives[_random(adjectives.length)]} ${
        colours[_random(colours.length)]
      } ${nouns[_random(nouns.length)]}`,
    };
  }
  return data;
}

// --- TypeScript Definitions ---

export interface RowData {
  id: number;
  label: string;
  selected?: boolean;
}

export interface AppState {
  data: RowData[];
}

export interface RowProps {
  item: RowData;
  onSelect: (item: RowData) => void;
  onRemove: (id: number) => void;
}

// --- Storable Implementation ---

const store = createReactive<AppState>({
  data: [],
});

// Selection lives on the row itself (item.selected). Each Row subscribes only
// to its own item's signal, so selecting writes exactly two signals (deselect
// old, select new) instead of re-evaluating a derived value per row.
let selectedRow: RowData | null = null;

// Bumped on any wholesale rebuild (clear AND run) so the <tbody> remounts via
// a key change.
//
// - On clear: React detaches the old tbody with a single removeChild instead
//   of removing 1,000 rows one by one during the deletion commit.
// - On run: a freshly-mounted tbody receives its children through React's
//   appendAllChildren fast path. Without the remount, placing N new rows into
//   the already-mounted tbody calls getHostSibling per row, which scans
//   forward through the not-yet-mounted sibling fibers — O(n²). Profiled on
//   this app: 1.3ms at 1k rows vs 135ms (15.8% of total) at 10k.
let tbodyEpoch = 0;

export const run = (count: number) => {
  tbodyEpoch++;
  store.data = buildData(count);
  selectedRow = null;
};

export const add = () => {
  store.data.push(...buildData(1000));
};

export const update = () => {
  batch(() => {
    for (let i = 0; i < store.data.length; i += 10) {
      store.data[i].label = store.data[i].label + " !!!";
    }
  });
};

export const clear = () => {
  tbodyEpoch++;
  batch(() => {
    store.data = [];
    selectedRow = null;
  });
};

export const swapRows = () => {
  if (store.data.length > 998) {
    batch(() => {
      const row1 = store.data[1];
      const row998 = store.data[998];
      store.data[1] = row998;
      store.data[998] = row1;
    });
  }
};

export const remove = (id: number) => {
  const index = store.data.findIndex((item) => item.id === id);
  if (index !== -1) {
    if (selectedRow && selectedRow.id === id) {
      selectedRow = null;
    }
    store.data.splice(index, 1);
  }
};

export const select = (itemOrId: RowData | number) => {
  const item = typeof itemOrId === "number" ? store.data.find((d) => d.id === itemOrId) : itemOrId;
  // Re-selecting the current row writes nothing. (The old `store.selected = id`
  // model no-op'd here too — `setProperty` skips unchanged writes — so this
  // isn't new, just explicit.) It does mean a benchmark that times a click on
  // an already-selected row measures nothing; perf.test.ts asserts the timed
  // row isn't the warmed-up one to catch that.
  if (!item || (selectedRow && selectedRow.id === item.id)) {
    return;
  }
  flushSync(() => {
    batch(() => {
      if (selectedRow) {
        selectedRow.selected = false;
      }
      item.selected = true;
      selectedRow = item;
    });
  });
};

// --- Profiling ---

enableProfiling();

let rowRenderCount = 0;
let appRenderCount = 0;
let forRenderCount = 0;
let reactCommitCount = 0;

function onRenderProfiler(
  _id: string,
  _phase: string,
  _actualDuration: number,
  _baseDuration: number,
  _startTime: number,
  _commitTime: number,
) {
  reactCommitCount++;
}

export function startProfiling() {
  resetProfiler();
  rowRenderCount = 0;
  appRenderCount = 0;
  forRenderCount = 0;
  reactCommitCount = 0;
}

export function getProfilingResults() {
  const signalProfile = getProfile();
  return {
    ...signalProfile,
    rowRenderCount,
    appRenderCount,
    forRenderCount,
    reactCommitCount,
  };
}

// Expose on window for Playwright
if (typeof window !== "undefined") {
  (window as any).__startProfiling = startProfiling;
  (window as any).__getProfilingResults = getProfilingResults;
}

// --- React Components ---

const Button = ({ id, cb, title }: { id: string; cb: () => void; title: string }) => (
  <div className="col-sm-6 smallpad">
    <button type="button" className="btn btn-primary btn-block" id={id} onClick={cb}>
      {title}
    </button>
  </div>
);

export const Row = tracked(({ item, onSelect, onRemove }: RowProps) => {
  rowRenderCount++;
  return (
    <tr className={item.selected ? "danger" : ""}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4">
        <a onClick={() => onSelect(item)}>{item.label}</a>
      </td>
      <td className="col-md-1">
        <a onClick={() => onRemove(item.id)}>
          <span className="glyphicon glyphicon-remove" aria-hidden="true"></span>
        </a>
      </td>
      <td className="col-md-6"></td>
    </tr>
  );
});

export const App = tracked(() => {
  appRenderCount++;
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const handleSelect = useCallback((item: RowData) => select(item), []);
  const handleRemove = useCallback((id: number) => remove(id), []);

  return (
    <Profiler id="app" onRender={onRenderProfiler}>
      <div className="container">
        <div className="jumbotron">
          <div className="row">
            <div className="col-md-6">
              <h1>React + Supergrain</h1>
            </div>
            <div className="col-md-6">
              <div className="row">
                <Button id="run" title="Create 1,000 rows" cb={() => run(1000)} />
                <Button id="runlots" title="Create 10,000 rows" cb={() => run(10000)} />
                <Button id="add" title="Append 1,000 rows" cb={add} />
                <Button id="update" title="Update every 10th row" cb={update} />
                <Button id="clear" title="Clear" cb={clear} />
                <Button id="swaprows" title="Swap Rows" cb={swapRows} />
              </div>
            </div>
          </div>
        </div>
        <table className="table table-hover table-striped test-data">
          <tbody key={tbodyEpoch} ref={tbodyRef}>
            <For each={store.data} parent={tbodyRef}>
              {(item: RowData) => (
                <Row key={item.id} item={item} onSelect={handleSelect} onRemove={handleRemove} />
              )}
            </For>
          </tbody>
        </table>
        <span className="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
      </div>
    </Profiler>
  );
});

// --- React Rendering ---
if (typeof window !== "undefined") {
  const container = document.getElementById("main");
  if (container) {
    const root = createRoot(container);
    root.render(<App />);
  }
}
