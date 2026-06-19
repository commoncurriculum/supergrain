import { createReactive } from "@supergrain/kernel";
import { describe, it, expect } from "vitest";

import { update } from "../../src";
import { applyWithUndo } from "../helpers";

// =============================================================================
// $mul — multiply a numeric field
// =============================================================================

describe("$mul", () => {
  it("multiplies an existing number", () => {
    const store = createReactive({ price: 10 });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $mul: { price: 3 } });
    expect(store.price).toBe(30);
    rewindAndAssertRestored();
  });

  it("treats a missing field as 0", () => {
    const store = createReactive<{ price?: number }>({});
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $mul: { price: 5 } });
    expect(store.price).toBe(0);
    rewindAndAssertRestored();
  });

  it("$mul by a float", () => {
    const store = createReactive<any>({ n: 4 });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $mul: { n: 1.5 } });
    expect(store.n).toBe(6);
    rewindAndAssertRestored();
  });

  it("$mul by zero", () => {
    const store = createReactive<any>({ n: 7 });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $mul: { n: 0 } });
    expect(store.n).toBe(0);
    rewindAndAssertRestored();
  });

  it("rejects a non-number target", () => {
    const store = createReactive<any>({ price: "ten" });
    expect(() => update(store, {}, { $mul: { price: 2 } })).toThrow(/number/i);
  });
});
