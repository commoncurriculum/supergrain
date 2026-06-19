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

  it("$inc creates an absent (undefined) field", () => {
    const store = createReactive<any>({ fromUndefined: undefined });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $inc: { fromUndefined: 4 } });
    expect(store.fromUndefined).toBe(4);
    rewindAndAssertRestored();
  });

  it("$inc on an existing null throws, like MongoDB", () => {
    const store = createReactive<any>({ fromNull: null });
    expect(() => update(store, {}, { $inc: { fromNull: 3 } })).toThrow(/number/i);
    expect(store.fromNull).toBe(null);
  });

  it("numeric operators reject creating a field inside a scalar, like MongoDB", () => {
    const incStore = createReactive<any>({ a: 42 });
    const minStore = createReactive<any>({ a: 42 });
    const maxStore = createReactive<any>({ a: 42 });

    expect(() => update(incStore, {}, { $inc: { "a.b": 1 } })).toThrow(/cannot create field/i);
    expect(() => update(minStore, {}, { $min: { "a.c": 2 } })).toThrow(/cannot create field/i);
    expect(() => update(maxStore, {}, { $max: { "a.d": 3 } })).toThrow(/cannot create field/i);

    expect(incStore.a).toBe(42);
    expect(minStore.a).toBe(42);
    expect(maxStore.a).toBe(42);
  });
});
