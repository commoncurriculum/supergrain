import { createStore } from "@supergrain/core";
import { tracked, For } from "@supergrain/react";
import { useCallback } from "react";
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
}

export interface AppState {
  data: RowData[];
  selected: number | null;
}

export interface RowProps {
  item: RowData;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onRemove: (id: number) => void;
}

// --- Storable Implementation ---

const [store] = createStore<AppState>({
  data: [],
  selected: null,
});

export const run = (count: number) => {
  store.data = buildData(count);
  store.selected = null;
};

export const add = () => {
  store.data = [...store.data, ...buildData(1000)];
};

export const update = () => {
  for (let i = 0; i < store.data.length; i += 10) {
    store.data[i].label = store.data[i].label + " !!!";
  }
};

export const clear = () => {
  store.data = [];
  store.selected = null;
};

export const swapRows = () => {
  if (store.data.length > 998) {
    const row1 = store.data[1];
    const row998 = store.data[998];
    store.data[1] = row998;
    store.data[998] = row1;
  }
};

export const remove = (id: number) => {
  store.data = store.data.filter((item) => item.id !== id);
};

export const select = (id: number) => {
  store.selected = id;
};

// Attach event listeners to the static buttons on startup
if (typeof window !== "undefined" && document.getElementById("run")) {
  document.getElementById("run")!.addEventListener("click", () => run(1000));
  document.getElementById("runlots")!.addEventListener("click", () => run(10000));
  document.getElementById("add")!.addEventListener("click", add);
  document.getElementById("update")!.addEventListener("click", update);
  document.getElementById("clear")!.addEventListener("click", clear);
  document.getElementById("swaprows")!.addEventListener("click", swapRows);
}

// --- React Components ---

export const Row = tracked(({ item, isSelected, onSelect, onRemove }: RowProps) => {
  return (
    <tr className={isSelected ? "danger" : ""}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4">
        <a onClick={() => onSelect(item.id)}>{item.label}</a>
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
  const handleSelect = useCallback((id: number) => select(id), []);
  const handleRemove = useCallback((id: number) => remove(id), []);

  const selected = store.selected;

  return (
    <For each={store.data}>
      {(item: RowData) => (
        <Row
          key={item.id}
          item={item}
          isSelected={selected === item.id}
          onSelect={handleSelect}
          onRemove={handleRemove}
        />
      )}
    </For>
  );
});

// --- React Rendering ---
if (typeof window !== "undefined" && document.getElementById("tbody")) {
  const container = document.getElementById("tbody");
  const root = createRoot(container!);
  root.render((<App />) as any);
}
