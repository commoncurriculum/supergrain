import { createReactive } from "@supergrain/kernel";
import { describe, it, expect } from "vitest";

import { update } from "../../src";
import { applyWithUndo } from "../helpers";

// =============================================================================
// $pop — remove the first or last element of an array
// =============================================================================

describe("$pop", () => {
  it("removes the last element with $pop: 1", () => {
    const store = createReactive({ items: ["a", "b", "c"] });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $pop: { items: 1 } });
    expect(store.items).toEqual(["a", "b"]);
    rewindAndAssertRestored();
  });

  it("removes the first element with $pop: -1", () => {
    const store = createReactive({ items: ["a", "b", "c"] });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $pop: { items: -1 } });
    expect(store.items).toEqual(["b", "c"]);
    rewindAndAssertRestored();
  });

  it("is a no-op on an empty array", () => {
    const store = createReactive({ items: [] as Array<string> });
    const { undo, rewindAndAssertRestored } = applyWithUndo(store, {}, { $pop: { items: 1 } });
    expect(store.items).toEqual([]);
    expect(undo).toEqual({});
    rewindAndAssertRestored();
  });

  it("is a no-op when the field (and its parent) is missing", () => {
    const store = createReactive<any>({ keep: 1 });
    const { undo, rewindAndAssertRestored } = applyWithUndo(store, {}, { $pop: { "a.items": 1 } });
    expect(store.a).toBeUndefined();
    expect(undo).toEqual({});
    rewindAndAssertRestored();
  });

  it("rejects a non-array target", () => {
    const store = createReactive<any>({ items: 5 });
    expect(() => update(store, {}, { $pop: { items: 1 } })).toThrow(/array/i);
  });

  it("rejects a direction other than 1 or -1, like MongoDB", () => {
    const store = createReactive<any>({ items: ["a", "b"] });
    expect(() => update(store, {}, { $pop: { items: 0 } as any })).toThrow(/expects 1 or -1/i);
    expect(store.items).toEqual(["a", "b"]);
  });
});
