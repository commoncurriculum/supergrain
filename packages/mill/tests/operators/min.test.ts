import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { applyWithUndo, undoRecorder } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$min: should update if value is smaller", () => {
    const state = createReactive({ score: 100 });
    const rec = undoRecorder(state);
    rec.apply({}, { $min: { score: 150 } });
    expect(state.score).toBe(100);
    rec.apply({}, { $min: { score: 50 } });
    expect(state.score).toBe(50);
    rec.rewindAndAssertRestored();
  });

  it("$min creates a new path when it does not exist", () => {
    const store = createReactive<any>({});
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $min: { score: 10 } });
    expect(store.score).toBe(10);
    rewindAndAssertRestored();
  });

  it("$min initializes existing undefined values", () => {
    const store = createReactive<any>({ score: undefined });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $min: { score: 10 } });
    expect(store.score).toBe(10);
    rewindAndAssertRestored();
  });

  it("$min and $max leave null values unchanged", () => {
    const minStore = createReactive<any>({ score: null });
    const maxStore = createReactive<any>({ score: null });

    const min = applyWithUndo(minStore, {}, { $min: { score: 10 } });
    const max = applyWithUndo(maxStore, {}, { $max: { score: 10 } });

    expect(minStore.score).toBe(null);
    expect(maxStore.score).toBe(null);
    expect(min.undo).toEqual({});
    expect(max.undo).toEqual({});
    min.rewindAndAssertRestored();
    max.rewindAndAssertRestored();
  });

  it("$min fires only when the value actually changes", () => {
    const store = createReactive({ score: 100 });
    const fn = vi.fn(() => void store.score);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    const rec = undoRecorder(store);
    rec.apply({}, { $min: { score: 150 } }); // 150 > 100, no-op
    expect(store.score).toBe(100);
    expect(fn).toHaveBeenCalledTimes(1);

    rec.apply({}, { $min: { score: 50 } }); // 50 < 100, writes
    expect(store.score).toBe(50);
    expect(fn).toHaveBeenCalledTimes(2);
    rec.rewindAndAssertRestored();
  });
});
