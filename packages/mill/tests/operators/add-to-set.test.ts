import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { applyWithUndo, undoRecorder } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$addToSet: should add unique elements to an array", () => {
    const state = createReactive({ tags: ["a", "b"] });
    const rec = undoRecorder(state);
    rec.apply({}, { $addToSet: { tags: "c" } });
    expect(state.tags).toEqual(["a", "b", "c"]);
    rec.apply({}, { $addToSet: { tags: "a" } }); // Try adding a duplicate
    expect(state.tags).toEqual(["a", "b", "c"]);
    rec.rewindAndAssertRestored();
  });

  it("$addToSet creates the array when the field is missing", () => {
    const store = createReactive<any>({ keep: 1 });
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $addToSet: { tags: "a" } },
    );
    expect(store.tags).toEqual(["a"]);
    expect(undo).toEqual({ $unset: { tags: "" } });
    rewindAndAssertRestored();
  });

  it("$addToSet creates the whole branch when an intermediate is missing", () => {
    const store = createReactive<any>({ keep: 1 });
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $addToSet: { "a.tags": "x" } },
    );
    expect(store.a).toEqual({ tags: ["x"] });
    expect(undo).toEqual({ $unset: { a: "" } });
    rewindAndAssertRestored();
  });

  it("$addToSet dedups Date values by time", () => {
    const store = createReactive<any>({ when: [new Date("2021-01-01T00:00:00.000Z")] });
    const rec = undoRecorder(store);

    rec.apply({}, { $addToSet: { when: new Date("2021-01-01T00:00:00.000Z") } }); // duplicate
    expect(store.when).toHaveLength(1);

    rec.apply({}, { $addToSet: { when: new Date("2022-01-01T00:00:00.000Z") } }); // new
    expect(store.when).toHaveLength(2);
    rec.rewindAndAssertRestored();
  });

  it("$addToSet: should handle $each modifier", () => {
    const state = createReactive({ tags: ["a", "b"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      { $addToSet: { tags: { $each: ["c", "a", "d"] } } },
    );
    expect(state.tags).toEqual(["a", "b", "c", "d"]);
    rewindAndAssertRestored();
  });

  it("$addToSet: should ignore duplicates inside $each", () => {
    const state = createReactive({ tags: ["a"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      {
        $addToSet: { tags: { $each: ["b", "b", "a", "c", "c"] } },
      },
    );
    expect(state.tags).toEqual(["a", "b", "c"]);
    rewindAndAssertRestored();
  });

  it("$addToSet deduplicates object elements using deep isEqual", () => {
    const store = createReactive<any>({ items: [{ id: 1, name: "Alice" }] });
    const rec = undoRecorder(store);
    rec.apply({}, { $addToSet: { items: { id: 1, name: "Alice" } } });
    expect(store.items).toHaveLength(1);

    rec.apply({}, { $addToSet: { items: { id: 2, name: "Bob" } } });
    expect(store.items).toHaveLength(2);

    rec.apply({}, { $addToSet: { items: { id: 1 } } });
    expect(store.items).toHaveLength(3);
    rec.rewindAndAssertRestored();
  });

  it("$addToSet handles large object values", () => {
    const keys = Array.from({ length: 50 }, (_, i) => `key${i}`);
    const obj1 = Object.fromEntries(keys.map((k) => [k, k]));
    const obj2 = Object.fromEntries(keys.map((k) => [k, k]));
    const store = createReactive<any>({ items: [obj1] });
    const rec = undoRecorder(store);

    rec.apply({}, { $addToSet: { items: obj2 } });
    expect(store.items).toHaveLength(1);

    const obj3 = { ...obj2, key0: "different" };
    rec.apply({}, { $addToSet: { items: obj3 } });
    expect(store.items).toHaveLength(2);
    rec.rewindAndAssertRestored();
  });

  it("$addToSet fires effects when adding a new element and stays silent on a duplicate", () => {
    const store = createReactive({ tags: ["a", "b"] as Array<string> });
    let length = -1;
    const lengthFn = vi.fn(() => {
      length = store.tags.length;
    });
    effect(lengthFn);
    expect(length).toBe(2);
    expect(lengthFn).toHaveBeenCalledTimes(1);

    const rec = undoRecorder(store);
    rec.apply({}, { $addToSet: { tags: "c" } });
    expect(length).toBe(3);
    expect(lengthFn).toHaveBeenCalledTimes(2);

    rec.apply({}, { $addToSet: { tags: "a" } });
    expect(length).toBe(3);
    // Duplicate didn't structurally change the array — no re-run.
    expect(lengthFn).toHaveBeenCalledTimes(2);
    rec.rewindAndAssertRestored();
  });
});

// =============================================================================
// Deep equality across array-valued elements ($addToSet / $pullAll)
// =============================================================================

describe("deep equality of array-valued elements", () => {
  it("$addToSet treats arrays of equal length but differing items as distinct", () => {
    const store = createReactive<{ rows: Array<Array<number>> }>({ rows: [[1, 2]] });
    const rec = undoRecorder(store);

    rec.apply({}, { $addToSet: { rows: [1, 3] } });
    expect(store.rows).toEqual([
      [1, 2],
      [1, 3],
    ]);

    // An exact-length, exact-value duplicate is rejected.
    rec.apply({}, { $addToSet: { rows: [1, 2] } });
    expect(store.rows).toHaveLength(2);
    rec.rewindAndAssertRestored();
  });

  it("$addToSet treats arrays of different lengths as distinct", () => {
    const store = createReactive<{ rows: Array<Array<number>> }>({ rows: [[1, 2]] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $addToSet: { rows: [1, 2, 3] } },
    );
    expect(store.rows).toHaveLength(2);
    rewindAndAssertRestored();
  });
});
