import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { update } from "../../src";
import { applyWithUndo } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$inc: should increment numeric values", () => {
    const state = createReactive({
      stats: { views: 100, likes: 50 },
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      { $inc: { "stats.views": 1, "stats.likes": -5 } },
    );
    expect(state.stats.views).toBe(101);
    expect(state.stats.likes).toBe(45);
    rewindAndAssertRestored();
  });

  it("should handle reactivity correctly", () => {
    const state = createReactive({ count: 0 });
    let currentCount = 0;
    const effectFn = vi.fn(() => {
      currentCount = state.count;
    });
    effect(effectFn);
    expect(currentCount).toBe(0);
    expect(effectFn).toHaveBeenCalledTimes(1);
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $inc: { count: 1 } });
    expect(currentCount).toBe(1);
    expect(effectFn).toHaveBeenCalledTimes(2);
    rewindAndAssertRestored();
  });

  it("$inc on an array-valued path produces a descriptive error", () => {
    const store = createReactive<any>({ items: [1, 2] });
    expect(() => update(store, {}, { $inc: { items: 1 } as any })).toThrow(/array/i);
  });

  it("$inc creates a new path when it does not exist", () => {
    const store = createReactive<any>({});
    const { undo, rewindAndAssertRestored } = applyWithUndo(store, {}, { $inc: { newCounter: 5 } });
    expect(store.newCounter).toBe(5);
    expect(undo).toEqual({ $unset: { newCounter: "" } });
    rewindAndAssertRestored();
  });

  it("$inc initializes existing null and undefined values", () => {
    const store = createReactive<any>({ fromNull: null, fromUndefined: undefined });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $inc: { fromNull: 3, fromUndefined: 4 } },
    );
    expect(store.fromNull).toBe(3);
    expect(store.fromUndefined).toBe(4);
    rewindAndAssertRestored();
  });

  it("numeric operators create missing nested paths when the parent resolver returns null", () => {
    const incStore = createReactive<any>({ a: 42 });
    const minStore = createReactive<any>({ a: 42 });
    const maxStore = createReactive<any>({ a: 42 });

    const inc = applyWithUndo(incStore, {}, { $inc: { "a.b": 1 } });
    const min = applyWithUndo(minStore, {}, { $min: { "a.c": 2 } });
    const max = applyWithUndo(maxStore, {}, { $max: { "a.d": 3 } });

    expect(incStore.a).toEqual({ b: 1 });
    expect(minStore.a).toEqual({ c: 2 });
    expect(maxStore.a).toEqual({ d: 3 });
    inc.rewindAndAssertRestored();
    min.rewindAndAssertRestored();
    max.rewindAndAssertRestored();
  });
});
