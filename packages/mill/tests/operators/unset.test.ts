import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { applyWithUndo } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$unset: should remove a property", () => {
    const state = createReactive({
      user: { name: "John", email: "john@doe.com" },
    });
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $unset: { "user.email": 1 } });
    expect(state.user.name).toBe("John");
    expect((state.user as any).email).toBeUndefined();
    rewindAndAssertRestored();
  });

  it("$unset fires effects observing the removed property and ownKeys watchers", () => {
    const store = createReactive<{ a: number; b?: number }>({ a: 1, b: 2 });
    let observedB: number | undefined = -1;
    const bFn = vi.fn(() => {
      observedB = store.b;
    });
    let keys: string[] = [];
    const keysFn = vi.fn(() => {
      keys = Object.keys(store);
    });
    effect(bFn);
    effect(keysFn);
    expect(observedB).toBe(2);
    expect(keys.sort()).toEqual(["a", "b"]);

    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $unset: { b: 1 } });

    expect(observedB).toBeUndefined();
    expect(bFn).toHaveBeenCalledTimes(2);
    expect(keys).toEqual(["a"]);
    expect(keysFn).toHaveBeenCalledTimes(2);
    rewindAndAssertRestored();
  });
});
