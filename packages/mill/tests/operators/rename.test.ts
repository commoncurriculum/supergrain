import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { update } from "../../src";
import { applyWithUndo, undoRecorder } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("$rename: should rename fields", () => {
    const state = createReactive<any>({
      user: { name: "John", address: { street: "123 Main St" } },
    });
    const rec = undoRecorder(state);
    rec.apply({}, { $rename: { "user.name": "user.fullName" } });
    rec.apply({}, { $rename: { "user.address": "user.location" } });
    expect((state.user as any).name).toBeUndefined();
    expect((state.user as any).fullName).toBe("John");
    expect((state.user as any).address).toBeUndefined();
    expect((state.user as any).location).toEqual({ street: "123 Main St" });
    rec.rewindAndAssertRestored();
  });

  it("should reject conflicting rename destinations", () => {
    const state = createReactive({
      user: { firstName: "John", fullName: "John Doe" },
    });

    expect(() => update(state, {}, { $rename: { "user.firstName": "user.fullName" } })).toThrow(
      /already exists/i,
    );
    expect(state.user.firstName).toBe("John");
    expect(state.user.fullName).toBe("John Doe");
  });

  it("rejects $rename through an array element, like MongoDB", () => {
    const store = createReactive<any>({ users: [{ name: "Alice" }] });
    expect(() => update(store, {}, { $rename: { "users.0.name": "users.0.fullName" } })).toThrow(
      /array element/i,
    );
    expect(store.users[0].name).toBe("Alice");
  });

  it("$rename ignores missing source paths", () => {
    const store = createReactive<any>({ user: { name: "Jane" } });
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $rename: { "user.missing": "user.other" } },
    );
    expect(store.user).toEqual({ name: "Jane" });
    expect(undo).toEqual({}); // no-op
    rewindAndAssertRestored();
  });

  it("$rename fires effects on both the source and destination paths", () => {
    const store = createReactive<{ user: { name?: string; fullName?: string } }>({
      user: { name: "John" },
    });
    let name: string | undefined;
    let fullName: string | undefined;
    const nameFn = vi.fn(() => {
      name = store.user.name;
    });
    const fullNameFn = vi.fn(() => {
      fullName = store.user.fullName;
    });
    effect(nameFn);
    effect(fullNameFn);
    expect(name).toBe("John");
    expect(fullName).toBeUndefined();

    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $rename: { "user.name": "user.fullName" } },
    );

    expect(store.user.name).toBeUndefined();
    expect(store.user.fullName).toBe("John");
    expect(name).toBeUndefined();
    expect(fullName).toBe("John");
    expect(nameFn).toHaveBeenCalledTimes(2);
    expect(fullNameFn).toHaveBeenCalledTimes(2);
    rewindAndAssertRestored();
  });
});
