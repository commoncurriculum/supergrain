// @ts-nocheck — benchmark file, sink variables prevent dead code elimination
// Per-operation cost isolation: proxy vs cached $NODE vs bare signal.
import { effect } from "alien-signals";
import { bench, describe } from "vitest";

import { createStore, unwrap } from "../src";
import { $NODE } from "../src/internal";

const store = createStore({ title: "Buy milk", count: 0, done: false });
const raw = unwrap(store) as any;
effect(() => {
  store.title;
  store.count;
  store.done;
});

// Use a sink to prevent dead code elimination
let _sink: any;

describe("Single property read, 100k iterations (reactive)", () => {
  bench("proxy", () => {
    let acc = "";
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = store.title as string;
      }
    });
    _sink = acc;
    dispose();
  });

  bench("cached $NODE", () => {
    const n = raw[$NODE];
    let acc = "";
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = n["title"]();
      }
    });
    _sink = acc;
    dispose();
  });

  bench("uncached $NODE", () => {
    const r = raw;
    let acc = "";
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = r[$NODE]["title"]();
      }
    });
    _sink = acc;
    dispose();
  });
});

describe("3 property reads, 100k iterations (reactive)", () => {
  bench("proxy", () => {
    let a: any, b: any, c: any;
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        a = store.title;
        b = store.count;
        c = store.done;
      }
    });
    _sink = [a, b, c];
    dispose();
  });

  bench("cached $NODE", () => {
    const n = raw[$NODE];
    let a: any, b: any, c: any;
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        a = n["title"]();
        b = n["count"]();
        c = n["done"]();
      }
    });
    _sink = [a, b, c];
    dispose();
  });

  bench("uncached $NODE", () => {
    const r = raw;
    let a: any, b: any, c: any;
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        a = r[$NODE]["title"]();
        b = r[$NODE]["count"]();
        c = r[$NODE]["done"]();
      }
    });
    _sink = [a, b, c];
    dispose();
  });
});
