import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { applyWithUndo } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$push: should add an element to an array", () => {
    const state = createReactive({ tags: ["a", "b"] });
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $push: { tags: "c" } });
    expect(state.tags).toEqual(["a", "b", "c"]);
    rewindAndAssertRestored();
  });

  it("$push creates the array when the field is missing", () => {
    const store = createReactive<any>({ keep: 1 });
    const { undo, rewindAndAssertRestored } = applyWithUndo(store, {}, { $push: { tags: "a" } });
    expect(store.tags).toEqual(["a"]);
    expect(undo).toEqual({ $unset: { tags: "" } });
    rewindAndAssertRestored();
  });

  it("$push creates the whole branch when an intermediate is missing", () => {
    const store = createReactive<any>({ keep: 1 });
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { "a.items": "x" } },
    );
    expect(store.a).toEqual({ items: ["x"] });
    expect(undo).toEqual({ $unset: { a: "" } });
    rewindAndAssertRestored();
  });

  it("$push: should add multiple elements with $each", () => {
    const state = createReactive({ tags: ["a", "b"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      { $push: { tags: { $each: ["c", "d"] } } },
    );
    expect(state.tags).toEqual(["a", "b", "c", "d"]);
    rewindAndAssertRestored();
  });

  it("$push fires effects subscribed to length and to iteration", () => {
    const store = createReactive<{ items: Array<{ id: number }> }>({
      items: [{ id: 1 }],
    });
    let length = -1;
    const lengthFn = vi.fn(() => {
      length = store.items.length;
    });
    let ids: Array<number> = [];
    const iterFn = vi.fn(() => {
      ids = store.items.map((i) => i.id);
    });
    effect(lengthFn);
    effect(iterFn);

    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $push: { items: { id: 2 } } });

    expect(length).toBe(2);
    expect(ids).toEqual([1, 2]);
    expect(lengthFn).toHaveBeenCalledTimes(2);
    expect(iterFn).toHaveBeenCalledTimes(2);
    rewindAndAssertRestored();
  });
});

// =============================================================================
// $push modifiers — $position, $slice, $sort (all standard Mongo)
// =============================================================================

describe("$push modifiers", () => {
  it("$position inserts at an index", () => {
    const store = createReactive({ items: ["a", "d"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $push: { items: { $each: ["b", "c"], $position: 1 } },
      },
    );
    expect(store.items).toEqual(["a", "b", "c", "d"]);
    rewindAndAssertRestored();
  });

  it("$position counts from the end when negative", () => {
    const store = createReactive({ items: ["a", "b", "d"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $push: { items: { $each: ["c"], $position: -1 } },
      },
    );
    expect(store.items).toEqual(["a", "b", "c", "d"]);
    rewindAndAssertRestored();
  });

  it("$slice keeps the first N after appending", () => {
    const store = createReactive({ items: [1, 2, 3] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { items: { $each: [4, 5], $slice: 3 } } },
    );
    expect(store.items).toEqual([1, 2, 3]);
    rewindAndAssertRestored();
  });

  it("$slice with a negative count keeps the last N", () => {
    const store = createReactive({ items: [1, 2, 3] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { items: { $each: [4, 5], $slice: -2 } } },
    );
    expect(store.items).toEqual([4, 5]);
    rewindAndAssertRestored();
  });

  it("$sort orders scalar elements ascending", () => {
    const store = createReactive({ scores: [3, 1] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { scores: { $each: [2], $sort: 1 } } },
    );
    expect(store.scores).toEqual([1, 2, 3]);
    rewindAndAssertRestored();
  });

  it("$sort orders mixed types by MongoDB's BSON type ordering (numbers before strings)", () => {
    const store = createReactive<any>({ a: [3, "x", 1] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { a: { $each: [], $sort: 1 } } },
    );
    expect(store.a).toEqual([1, 3, "x"]);
    rewindAndAssertRestored();
  });

  it("$sort places a document missing the sort key first (missing sorts as null)", () => {
    const store = createReactive<any>({
      players: [{ score: 5 }, { name: "no-score" }],
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { players: { $each: [], $sort: { score: 1 } } } },
    );
    expect(store.players).toEqual([{ name: "no-score" }, { score: 5 }]);
    rewindAndAssertRestored();
  });

  it("$sort orders across BSON types (number < string < object < array < boolean)", () => {
    const store = createReactive<any>({ a: [true, [1], { x: 1 }, "s", 5] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { a: { $each: [], $sort: 1 } } },
    );
    expect(store.a).toEqual([5, "s", { x: 1 }, [1], true]);
    rewindAndAssertRestored();
  });

  it("$sort orders booleans false before true", () => {
    const store = createReactive<any>({ a: [true, false, true] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { a: { $each: [], $sort: 1 } } },
    );
    expect(store.a).toEqual([false, true, true]);
    rewindAndAssertRestored();
  });

  it("$sort keeps elements that both lack the sort key stable", () => {
    const store = createReactive<any>({ players: [{ name: "a" }, { name: "b" }] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { players: { $each: [], $sort: { score: 1 } } } },
    );
    expect(store.players).toEqual([{ name: "a" }, { name: "b" }]);
    rewindAndAssertRestored();
  });

  it("$sort orders document elements by a field", () => {
    const store = createReactive({
      players: [
        { name: "A", score: 30 },
        { name: "B", score: 10 },
      ],
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $push: { players: { $each: [{ name: "C", score: 20 }], $sort: { score: 1 } } },
      },
    );
    expect(store.players.map((p) => p.name)).toEqual(["B", "C", "A"]);
    rewindAndAssertRestored();
  });

  it("$sort keeps equal scalar elements stable", () => {
    const store = createReactive({ scores: [2] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { scores: { $each: [2], $sort: 1 } } },
    );
    expect(store.scores).toEqual([2, 2]);
    rewindAndAssertRestored();
  });

  it("$sort keeps document elements with equal keys stable", () => {
    const store = createReactive({ rows: [{ score: 5, name: "a" }] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $push: { rows: { $each: [{ score: 5, name: "b" }], $sort: { score: 1 } } },
      },
    );
    expect(store.rows.map((r) => r.score)).toEqual([5, 5]);
    rewindAndAssertRestored();
  });
});
