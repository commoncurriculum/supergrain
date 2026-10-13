import { describe, it, expect, vi } from "vitest";

import { createReactive, effect, unwrap } from "../../src";

// `map`, `forEach`, `filter`, `flatMap`, `reduce`, and `reduceRight` run on the
// raw array with one subscription to the array as a whole, instead of one per
// index. These pin that subscribers still re-run on every change that matters,
// and that callbacks still see reactive elements.
describe("Whole-array iteration methods", () => {
  const isReactive = (value: unknown) => unwrap(value) !== value;
  const rows = () => [
    { id: 1, label: "a" },
    { id: 2, label: "b" },
    { id: 3, label: "c" },
  ];

  it("a map subscriber re-runs on push, splice, index replacement, and sort", () => {
    const store = createReactive({ items: rows() });
    let ids: Array<number> = [];
    const run = vi.fn(() => {
      ids = store.items.map((item) => item.id);
    });
    effect(run);
    expect(ids).toEqual([1, 2, 3]);

    store.items.push({ id: 4, label: "d" });
    expect(ids).toEqual([1, 2, 3, 4]);

    store.items.splice(0, 1);
    expect(ids).toEqual([2, 3, 4]);

    store.items[1] = { id: 9, label: "z" };
    expect(ids).toEqual([2, 9, 4]);

    store.items.sort((a, b) => a.id - b.id);
    expect(ids).toEqual([2, 4, 9]);

    expect(run).toHaveBeenCalledTimes(5);
  });

  it("an element's fields are tracked only where the callback read them", () => {
    const store = createReactive({ items: rows() });
    const run = vi.fn(() => void store.items.map((item) => item.id));
    effect(run);

    store.items[0]!.label = "changed";
    expect(run).toHaveBeenCalledTimes(1);

    store.items[0]!.id = 10;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("assigning an element its current value does not re-run the subscriber", () => {
    const store = createReactive({ items: rows() });
    const run = vi.fn(() => void store.items.forEach(() => {}));
    effect(run);

    store.items[1] = store.items[1]!;

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("callbacks receive reactive elements, the index, and the reactive array", () => {
    const store = createReactive({ items: rows() });
    const seen: Array<[unknown, number, unknown]> = [];
    const context = { tag: "this" };

    store.items.forEach(function (this: unknown, item, index, array) {
      expect(this).toBe(context);
      seen.push([item, index, array]);
    }, context);

    expect(seen.map(([item]) => isReactive(item))).toEqual([true, true, true]);
    expect(seen.map(([, index]) => index)).toEqual([0, 1, 2]);
    expect(seen.every(([, , array]) => array === store.items)).toBe(true);
  });

  it("filter returns reactive elements", () => {
    const store = createReactive({ items: rows() });

    const kept = store.items.filter((item) => item.id !== 2);

    expect(kept.map((item) => item.label)).toEqual(["a", "c"]);
    expect(kept.every(isReactive)).toBe(true);
  });

  it("flatMap maps and flattens", () => {
    const store = createReactive({ items: rows() });

    expect(store.items.flatMap((item) => [item.id, item.id * 10])).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it("reduce and reduceRight pass reactive elements, with or without an initial value", () => {
    const store = createReactive({ items: rows() });

    const withInitial = store.items.reduce((labels, item) => {
      expect(isReactive(item)).toBe(true);
      return labels + item.label;
    }, "");
    expect(withInitial).toBe("abc");

    const right = store.items.reduceRight((labels, item) => labels + item.label, "");
    expect(right).toBe("cba");

    const longest = store.items.reduce((best, item) => (item.id > best.id ? item : best));
    expect(longest.label).toBe("c");
    expect(isReactive(longest)).toBe(true);
  });

  it("a non-function callback throws the native TypeError", () => {
    const store = createReactive({ items: rows() });

    expect(() => store.items.map(undefined as unknown as () => void)).toThrow(TypeError);
    expect(() => store.items.reduce(undefined as unknown as (acc: number) => number, 0)).toThrow(
      TypeError,
    );
  });

  it("a reduce subscriber re-runs when the array changes", () => {
    const store = createReactive({ items: [1, 2, 3] });
    let total = 0;
    effect(() => {
      total = store.items.reduce((sum, n) => sum + n, 0);
    });
    expect(total).toBe(6);

    store.items.push(4);
    expect(total).toBe(10);

    store.items[0] = 10;
    expect(total).toBe(19);
  });
});
