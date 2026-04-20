import { update } from "@supergrain/operators";
// Table row operations (select, swap, append, delete) — krauset-style benchmarks.
import { bench, describe } from "vitest";

import { createReactive, effect } from "../src";

// --- Data Generation Utilities ---

let idCounter = 1;

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

const _random = (max: number): number => Math.round(Math.random() * 1000) % max;

interface RowData {
  id: number;
  label: string;
}

interface AppState {
  data: RowData[];
  selected: number | null;
}

const buildData = (count = 1000): RowData[] => {
  const data: RowData[] = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idCounter++,
      label: `${adjectives[_random(adjectives.length)]} ${
        colours[_random(colours.length)]
      } ${nouns[_random(nouns.length)]}`,
    };
  }
  // Reset for consistent benchmark runs
  idCounter = 1;
  return data;
};

// --- Benchmark Suite ---

describe("Core: Row Operations", () => {
  bench(
    "select row: highlighting a selected row in a table of 1,000 rows",
    () => {
      const store = createReactive<AppState>({
        data: buildData(1000),
        selected: null,
      });

      // Track the selected value to ensure the benchmark measures reactive updates
      const dispose = effect(() => {
        void store.selected; // Track for reactivity
      });

      // Select a row in the middle of the dataset
      // @ts-ignore
      update(store, { $set: { selected: store.data[500].id } });

      dispose();
    },
    {
      warmupIterations: 5,
      iterations: 20,
    },
  );

  bench(
    "swap rows: swapping two rows in a table of 1,000 rows",
    () => {
      const store = createReactive<AppState>({
        data: buildData(1000),
        selected: null,
      });

      // Create an effect to ensure reactivity is triggered and measured
      const dispose = effect(() => {
        if (store.data.length > 1) {
          // @ts-ignore
          void store.data[1].label; // Track for reactivity
        }
      });

      if (store.data.length > 998) {
        const row1 = store.data[1];
        const row998 = store.data[998];
        update(store, {
          $set: {
            "data.1": row998,
            "data.998": row1,
          },
        });
      }

      dispose();
    },
    {
      warmupIterations: 5,
      iterations: 20,
    },
  );
});
