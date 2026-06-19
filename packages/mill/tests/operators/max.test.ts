import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { applyWithUndo, undoRecorder } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$max: should update if value is larger", () => {
    const state = createReactive({ score: 100 });
    const rec = undoRecorder(state);
    rec.apply({}, { $max: { score: 50 } });
    expect(state.score).toBe(100);
    rec.apply({}, { $max: { score: 150 } });
    expect(state.score).toBe(150);
    rec.rewindAndAssertRestored();
  });

  it("$max creates a new path when it does not exist", () => {
    const store = createReactive<any>({});
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $max: { score: 10 } });
    expect(store.score).toBe(10);
    rewindAndAssertRestored();
  });

  it("$max initializes existing undefined values", () => {
    const store = createReactive<any>({ score: undefined });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $max: { score: 10 } });
    expect(store.score).toBe(10);
    rewindAndAssertRestored();
  });

  it("$max fires only when the value actually changes", () => {
    const store = createReactive({ score: 100 });
    const fn = vi.fn(() => void store.score);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    const rec = undoRecorder(store);
    rec.apply({}, { $max: { score: 50 } }); // 50 < 100, no-op
    expect(store.score).toBe(100);
    expect(fn).toHaveBeenCalledTimes(1);

    rec.apply({}, { $max: { score: 150 } }); // 150 > 100, writes
    expect(store.score).toBe(150);
    expect(fn).toHaveBeenCalledTimes(2);
    rec.rewindAndAssertRestored();
  });

  it("$max with an equal value is a no-op", () => {
    const store = createReactive<any>({ score: 5 });
    const { undo, rewindAndAssertRestored } = applyWithUndo(store, {}, { $max: { score: 5 } });
    expect(undo).toEqual({});
    rewindAndAssertRestored();
  });
});
