import { createReactive, unwrap } from "@supergrain/kernel";
import { describe, expect, it } from "vitest";

import { update } from "../src";
import { recordedUpdate } from "./helpers";

// The defining invariant of the data-first undo: applying `undo` to the
// post-update document reverses the exact changes, restoring the original
// (including missing-vs-present). Each case asserts the round-trip and pins the
// shape of the generated undo document.

function roundTrip<T extends object>(initial: T, ops: any, query: any = {}) {
  const before = structuredClone(initial);
  const store = createReactive<T>(structuredClone(initial));
  // Forward op goes through the oracle recorder; the undo application stays raw.
  const { undo } = recordedUpdate(store, query, ops);
  const afterUpdate = structuredClone(unwrap(store));
  update(store, {}, undo);
  expect(unwrap(store)).toEqual(before);
  return { undo, afterUpdate };
}

describe("undo — scalar operators", () => {
  it("$set on an existing field restores the prior value", () => {
    const { undo } = roundTrip({ a: 1, b: 2 }, { $set: { a: 10 } });
    expect(undo).toEqual({ $set: { a: 1 } });
  });

  it("$set on an absent field unsets it", () => {
    const { undo } = roundTrip({ a: 1 } as { a: number; b?: number }, { $set: { b: 5 } });
    expect(undo).toEqual({ $unset: { b: "" } });
  });

  it("$set creating a nested branch unsets the shallowest created segment", () => {
    const { undo } = roundTrip({} as Record<string, unknown>, {
      $set: { "a.b.c": 9 },
    });
    expect(undo).toEqual({ $unset: { a: "" } });
  });

  it("$set creating a field inside a scalar throws (no undo), like MongoDB", () => {
    const store = createReactive({ a: 42 } as Record<string, unknown>);
    expect(() => update(store, {}, { $set: { "a.b": 1 } })).toThrow(/cannot create field/i);
    expect(unwrap(store)).toEqual({ a: 42 });
  });

  it("$unset restores the removed value", () => {
    const { undo } = roundTrip(
      { user: { name: "John", email: "x@y.z" } },
      {
        $unset: { "user.email": 1 },
      },
    );
    expect(undo).toEqual({ $set: { "user.email": "x@y.z" } });
  });

  it("$inc restores the prior number", () => {
    const { undo } = roundTrip({ count: 5 }, { $inc: { count: 3 } });
    expect(undo).toEqual({ $set: { count: 5 } });
  });

  it("$inc that creates a field unsets it", () => {
    const { undo } = roundTrip({} as { n?: number }, { $inc: { n: 4 } });
    expect(undo).toEqual({ $unset: { n: "" } });
  });

  it("$mul restores the prior number", () => {
    const { undo } = roundTrip({ price: 10 }, { $mul: { price: 3 } });
    expect(undo).toEqual({ $set: { price: 10 } });
  });

  it("$min restores when it lowers the value", () => {
    const { undo } = roundTrip({ score: 100 }, { $min: { score: 50 } });
    expect(undo).toEqual({ $set: { score: 100 } });
  });

  it("$rename reverses the move", () => {
    const { undo } = roundTrip(
      { user: { name: "John" } } as { user: { name?: string; fullName?: string } },
      { $rename: { "user.name": "user.fullName" } },
    );
    expect(undo).toEqual({ $set: { "user.name": "John" }, $unset: { "user.fullName": "" } });
  });
});

describe("undo — array operators (fine-grained happy path)", () => {
  it("$push of one element pops it", () => {
    const { undo } = roundTrip({ items: ["a", "b"] }, { $push: { items: "c" } });
    expect(undo).toEqual({ $pop: { items: 1 } });
  });

  it("$push of many truncates back to the prior length", () => {
    const { undo } = roundTrip({ items: ["a"] }, { $push: { items: { $each: ["b", "c"] } } });
    expect(undo).toEqual({ $push: { items: { $each: [], $slice: 1 } } });
  });

  it("$addToSet of new elements truncates", () => {
    const { undo } = roundTrip(
      { tags: ["a"] },
      { $addToSet: { tags: { $each: ["b", "c", "a"] } } },
    );
    expect(undo).toEqual({ $push: { tags: { $each: [], $slice: 1 } } });
  });

  it("$pop:1 re-appends the removed tail", () => {
    const { undo } = roundTrip({ items: ["a", "b", "c"] }, { $pop: { items: 1 } });
    expect(undo).toEqual({ $push: { items: "c" } });
  });

  it("$pop:-1 re-inserts at the front", () => {
    const { undo } = roundTrip({ items: ["a", "b", "c"] }, { $pop: { items: -1 } });
    expect(undo).toEqual({ $push: { items: { $each: ["a"], $position: 0 } } });
  });

  it("$pull of a contiguous run re-inserts it at its original position", () => {
    const { undo } = roundTrip(
      { items: [1, 2, 3, 4, 5] },
      { $pull: { items: { $in: [2, 3] } } as any },
    );
    // 2 and 3 are contiguous at index 1.
    expect(undo).toEqual({ $push: { items: { $each: [2, 3], $position: 1 } } });
  });

  it("$pull of scattered matches falls back to restoring the whole array", () => {
    const { undo } = roundTrip({ items: [1, 2, 1, 3, 1] }, { $pull: { items: 1 } });
    expect(undo).toEqual({ $set: { items: [1, 2, 1, 3, 1] } });
  });
});

describe("undo — no-ops produce no undo", () => {
  it("$set to the same value", () => {
    const { undo } = roundTrip({ a: 1 }, { $set: { a: 1 } });
    expect(undo).toEqual({});
  });

  it("$inc by zero", () => {
    const { undo } = roundTrip({ a: 5 }, { $inc: { a: 0 } });
    expect(undo).toEqual({});
  });

  it("$min that does not lower the value", () => {
    const { undo } = roundTrip({ a: 5 }, { $min: { a: 10 } });
    expect(undo).toEqual({});
  });

  it("$addToSet of an existing member", () => {
    const { undo } = roundTrip({ tags: ["a", "b"] }, { $addToSet: { tags: "a" } });
    expect(undo).toEqual({});
  });

  it("$pull that matches nothing", () => {
    const { undo } = roundTrip({ items: [1, 2, 3] }, { $pull: { items: 99 } });
    expect(undo).toEqual({});
  });
});
