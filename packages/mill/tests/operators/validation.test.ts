import { createReactive } from "@supergrain/kernel";
import { describe, it, expect } from "vitest";

import { update } from "../../src";

describe("MongoDB Style Operators", () => {
  it("should reject empty or malformed update paths", () => {
    const state = createReactive({ user: { name: "John" } });

    expect(() => update(state, {}, { $set: { "": "Jane" } as any })).toThrow(/must not be empty/i);
    expect(() => update(state, {}, { $set: { "user..name": "Jane" } as any })).toThrow(
      /empty path segments/i,
    );
    expect(state.user.name).toBe("John");
  });

  it("should reject array operators on non-array paths", () => {
    const store = createReactive({ user: { name: "John" } });

    expect(() => update(store, {}, { $push: { user: "x" } as any })).toThrow(/array/i);
    expect(() => update(store, {}, { $pull: { user: "x" } as any })).toThrow(/array/i);
    expect(() => update(store, {}, { $pullAll: { user: ["x"] } as any })).toThrow(/array/i);
    expect(() => update(store, {}, { $addToSet: { user: "x" } as any })).toThrow(/array/i);
  });

  it("should reject numeric operators on non-number paths", () => {
    const store = createReactive({ user: { name: "John" } });

    expect(() => update(store, {}, { $inc: { "user.name": 1 } as any })).toThrow(/number/i);
    expect(() => update(store, {}, { $min: { "user.name": 1 } as any })).toThrow(/number/i);
    expect(() => update(store, {}, { $max: { "user.name": 1 } as any })).toThrow(/number/i);
  });
});

describe("MongoDB Style Operators — validation and path creation", () => {
  it("$push/$pull on a null-valued path produces a descriptive error", () => {
    const store = createReactive<any>({ value: null });
    expect(() => update(store, {}, { $push: { value: "x" } })).toThrow(/null/i);
    expect(() => update(store, {}, { $pull: { value: "x" } })).toThrow(/null/i);
  });

  it("$push through a non-container intermediate throws", () => {
    const store = createReactive<any>({ a: 42 });
    expect(() => update(store, {}, { $push: { "a.items": "x" } })).toThrow(/must resolve/i);
  });

  it("rejects array operators when a deep parent path cannot be resolved", () => {
    const store = createReactive<any>({ a: 42 });
    expect(() => update(store, {}, { $push: { "a.b.c": "x" } })).toThrow(/must resolve/i);
  });
});
