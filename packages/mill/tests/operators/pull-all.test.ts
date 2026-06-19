import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { update } from "../../src";
import { applyWithUndo, undoRecorder } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$pullAll: should remove every occurrence of each listed value", () => {
    const state = createReactive({ scores: [1, 2, 3, 2, 4, 1] });
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $pullAll: { scores: [1, 2] } });
    expect(state.scores).toEqual([3, 4]);
    rewindAndAssertRestored();
  });

  it("$pullAll: should match whole documents by deep equality, not partial match", () => {
    const state = createReactive({
      users: [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
        { id: 3, name: "C" },
      ],
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      {
        $pullAll: {
          users: [
            { id: 1, name: "A" },
            { id: 3 } as any, // partial — must NOT match { id: 3, name: "C" }
          ],
        },
      },
    );
    expect(state.users).toEqual([
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ]);
    rewindAndAssertRestored();
  });

  it("$pullAll: should leave the array unchanged when nothing matches", () => {
    const state = createReactive({ scores: [1, 2, 3] });
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      { $pullAll: { scores: [4, 5] } },
    );
    expect(state.scores).toEqual([1, 2, 3]);
    expect(undo).toEqual({}); // no-op produces no undo
    rewindAndAssertRestored();
  });

  it("$pullAll on a missing field is a no-op", () => {
    const store = createReactive<any>({ keep: 1 });
    const { undo, rewindAndAssertRestored } = applyWithUndo(store, {}, { $pullAll: { tags: [1] } });
    expect(store.tags).toBeUndefined();
    expect(store.keep).toBe(1);
    expect(undo).toEqual({}); // no-op produces no undo
    rewindAndAssertRestored();
  });

  it("$pullAll: should reject a non-array operand with a descriptive error", () => {
    const state = createReactive({ scores: [1, 2, 3] });
    expect(() => update(state, {}, { $pullAll: { scores: 5 } as any })).toThrow(/array of values/i);
    expect(state.scores).toEqual([1, 2, 3]);
  });

  it("$pullAll: should invalidate array structure subscribers", () => {
    const state = createReactive({ scores: [1, 2, 3, 4] });
    let keys: string[] = [];

    effect(() => {
      keys = Object.keys(state.scores);
    });

    expect(keys).toEqual(["0", "1", "2", "3"]);
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $pullAll: { scores: [2, 4] } });
    expect(keys).toEqual(["0", "1"]);
    rewindAndAssertRestored();
  });

  it("$pullAll fires structure effects when elements are removed and stays silent otherwise", () => {
    const store = createReactive({ items: [1, 2, 3] as Array<number> });
    let length = -1;
    const lengthFn = vi.fn(() => {
      length = store.items.length;
    });
    effect(lengthFn);
    expect(length).toBe(3);
    expect(lengthFn).toHaveBeenCalledTimes(1);

    const rec = undoRecorder(store);
    rec.apply({}, { $pullAll: { items: [2] } });
    expect(length).toBe(2);
    expect(lengthFn).toHaveBeenCalledTimes(2);

    rec.apply({}, { $pullAll: { items: [99] } }); // nothing matches — no structural change
    expect(length).toBe(2);
    expect(lengthFn).toHaveBeenCalledTimes(2);
    rec.rewindAndAssertRestored();
  });
});
