import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { applyWithUndo } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$set: should set top-level and nested properties", () => {
    const state = createReactive({
      user: { name: "John", address: { city: "New York" } },
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      {
        $set: { "user.name": "Jane", "user.address.city": "Boston" },
      },
    );
    expect(state.user.name).toBe("Jane");
    expect(state.user.address.city).toBe("Boston");
    rewindAndAssertRestored();
  });

  it("$set creates missing nested paths", () => {
    const store = createReactive<any>({});
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $set: { "brand.new.path": "value" } },
    );
    expect(store.brand.new.path).toBe("value");
    expect(undo).toEqual({ $unset: { brand: "" } });
    rewindAndAssertRestored();
  });

  it("$set is a no-op when setting a Date equal (by time) to the current value", () => {
    const store = createReactive<any>({ at: new Date("2020-05-01T00:00:00.000Z") });
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $set: { at: new Date("2020-05-01T00:00:00.000Z") } },
    );
    expect(undo).toEqual({}); // equal Date → no write
    rewindAndAssertRestored();
  });

  it("$set replacing a Date with an object is not a no-op", () => {
    const store = createReactive<any>({ at: new Date("2020-05-01T00:00:00.000Z") });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $set: { at: { kind: "none" } } },
    );
    expect(store.at).toEqual({ kind: "none" });
    rewindAndAssertRestored();
  });

  it("$set fires effects subscribed to the written path and not to siblings", () => {
    const store = createReactive({ a: 1, b: 2 });
    const aFn = vi.fn(() => void store.a);
    const bFn = vi.fn(() => void store.b);
    effect(aFn);
    effect(bFn);

    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $set: { a: 10 } });

    expect(store.a).toBe(10);
    expect(aFn).toHaveBeenCalledTimes(2);
    expect(bFn).toHaveBeenCalledTimes(1);
    rewindAndAssertRestored();
  });
});
