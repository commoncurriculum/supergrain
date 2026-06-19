import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { applyWithUndo } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$pull: should remove elements from an array by value", () => {
    const state = createReactive({ scores: [1, 2, 3, 2, 4] });
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $pull: { scores: 2 } });
    expect(state.scores).toEqual([1, 3, 4]);
    rewindAndAssertRestored();
  });

  it("$pull: should remove elements matching an object", () => {
    const state = createReactive({
      users: [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
      ],
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      { $pull: { users: { id: 1, name: "A" } } },
    );
    expect(state.users).toEqual([{ id: 2, name: "B" }]);
    rewindAndAssertRestored();
  });

  it("$pull: should invalidate array structure subscribers", () => {
    const state = createReactive({ scores: [1, 2, 3] });
    let keys: string[] = [];

    effect(() => {
      keys = Object.keys(state.scores);
    });

    expect(keys).toEqual(["0", "1", "2"]);
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $pull: { scores: 2 } });
    expect(keys).toEqual(["0", "1"]);
    rewindAndAssertRestored();
  });

  it("$pull on a missing field is a no-op", () => {
    const store = createReactive<any>({ keep: 1 });
    const { undo, rewindAndAssertRestored } = applyWithUndo(store, {}, { $pull: { tags: 2 } });
    expect(store.tags).toBeUndefined();
    expect(store.keep).toBe(1);
    expect(undo).toEqual({}); // no-op produces no undo
    rewindAndAssertRestored();
  });

  it("$pull through a missing intermediate is a no-op", () => {
    const store = createReactive<any>({ keep: 1 });
    // Two missing segments ("a" and "b") — Mongo no-ops on the absent array.
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $pull: { "a.b.items": 2 } },
    );
    expect(store.a).toBeUndefined();
    expect(undo).toEqual({}); // no-op produces no undo
    rewindAndAssertRestored();
  });

  it("$pull mutates an untracked array without indexed subscribers", () => {
    const store = createReactive<any>({ items: [1, 2, 3] });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $pull: { items: 2 } });
    expect(store.items).toEqual([1, 3]);
    rewindAndAssertRestored();
  });

  it("$pull can update a raw object without reactive array nodes", () => {
    const store = { items: [1, 2, 3] };
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $pull: { items: 2 } });
    expect(store.items).toEqual([1, 3]);
    rewindAndAssertRestored();
  });

  it("$pull leaves unchanged indexed signals alone", () => {
    const store = createReactive<any>({ items: [1, 2, 3] });
    let first: number | undefined;
    let third: number | undefined;
    const firstFn = vi.fn(() => {
      first = store.items[0];
    });
    const thirdFn = vi.fn(() => {
      third = store.items[2];
    });

    effect(firstFn);
    effect(thirdFn);
    expect(first).toBe(1);
    expect(third).toBe(3);
    expect(firstFn).toHaveBeenCalledTimes(1);
    expect(thirdFn).toHaveBeenCalledTimes(1);

    // After $pull(2), the array is [1, 3]: index 0 still holds 1, index 2 is
    // empty. Only the index-2 effect should be invalidated.
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $pull: { items: 2 } });

    expect(first).toBe(1);
    expect(third).toBeUndefined();
    expect(firstFn).toHaveBeenCalledTimes(1);
    expect(thirdFn).toHaveBeenCalledTimes(2);
    rewindAndAssertRestored();
  });
});

// =============================================================================
// $pull with query conditions (standard Mongo query operators)
// =============================================================================

describe("$pull with query conditions", () => {
  it("removes elements matching an operator condition", () => {
    const store = createReactive({ nums: [1, 2, 3, 4, 5] });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $pull: { nums: { $gte: 4 } } });
    expect(store.nums).toEqual([1, 2, 3]);
    rewindAndAssertRestored();
  });

  it("removes elements matching a combined range condition", () => {
    const store = createReactive({ nums: [1, 2, 3, 4, 5] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $pull: { nums: { $gte: 2, $lte: 4 } } },
    );
    expect(store.nums).toEqual([1, 5]);
    rewindAndAssertRestored();
  });

  it("does not remove primitive elements when given a field condition", () => {
    const store = createReactive({ nums: [1, 2, 3] });
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $pull: { nums: { foo: 1 } } },
    );
    expect(store.nums).toEqual([1, 2, 3]);
    expect(undo).toEqual({});
    rewindAndAssertRestored();
  });

  it("removes documents matching a field-with-operator condition", () => {
    const store = createReactive({
      tasks: [
        { id: 1, priority: 1 },
        { id: 2, priority: 5 },
        { id: 3, priority: 9 },
      ],
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $pull: { tasks: { priority: { $gte: 5 } } },
      },
    );
    expect(store.tasks).toEqual([{ id: 1, priority: 1 }]);
    rewindAndAssertRestored();
  });
});
