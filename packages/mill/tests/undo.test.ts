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

// The undo document must itself be a legal update document. When several paths
// share a branch the update has to create, the first one captures the whole
// missing branch and the rest are redundant — emitting them anyway produced an
// undo that `update()` refused to replay ("would create a conflict between
// paths ...").
describe("undo — sibling writes under a created branch stay conflict-free", () => {
  it("collapses to the created branch for two $set siblings", () => {
    const { undo } = roundTrip({} as Record<string, unknown>, {
      $set: { "rel.course": { id: "c1" }, "rel.planbook": { id: "p1" } },
    });
    expect(undo).toEqual({ $unset: { rel: "" } });
  });

  it("collapses across a deeper shared branch", () => {
    const { undo } = roundTrip({ a: {} } as Record<string, unknown>, {
      $set: { "a.b.c": 1, "a.b.d": 2 },
    });
    expect(undo).toEqual({ $unset: { "a.b": "" } });
  });

  it("collapses across different operators", () => {
    const { undo } = roundTrip({} as Record<string, unknown>, {
      $set: { "rel.course": { id: "c1" } },
      $inc: { "rel.count": 2 },
      $push: { "rel.tags": "x" },
    });
    expect(undo).toEqual({ $unset: { rel: "" } });
  });

  it("keeps siblings that do not share a created branch", () => {
    const { undo } = roundTrip({ rel: {} } as Record<string, unknown>, {
      $set: { "rel.course": { id: "c1" }, "rel.planbook": { id: "p1" } },
    });
    expect(undo).toEqual({ $unset: { "rel.course": "", "rel.planbook": "" } });
  });

  it("collapses to a null intermediate under allowNullIntermediates", () => {
    const initial = { rel: null } as Record<string, unknown>;
    const store = createReactive(structuredClone(initial));

    const { undo } = update(
      store,
      {},
      { $set: { "rel.course": { id: "c1" }, "rel.planbook": { id: "p1" } } },
      { allowNullIntermediates: true },
    );
    expect(undo).toEqual({ $set: { rel: null } });

    update(store, {}, undo, { allowNullIntermediates: true });
    expect(unwrap(store)).toEqual(initial);
  });
});

// The covering entry doesn't always come first: an out-of-bounds index write
// forces a whole-array restore that can arrive *after* granular entries under
// the same array. The stale snapshot (earlier ops already wrote into it) must
// absorb those entries, not conflict with them.
describe("undo — whole-array snapshots arriving after granular entries", () => {
  it("in-bounds write, then out-of-bounds growth of the same array", () => {
    const { undo } = roundTrip({ arr: [10, 20, 30] } as Record<string, unknown>, {
      $set: { "arr.2": 99, "arr.5": 77 },
    });
    expect(undo).toEqual({ $set: { arr: [10, 20, 30] } });
  });

  it("out-of-bounds growth, then in-bounds write (covering entry first)", () => {
    const { undo } = roundTrip({ arr: [10, 20, 30] } as Record<string, unknown>, {
      $set: { "arr.5": 77, "arr.2": 99 },
    });
    expect(undo).toEqual({ $set: { arr: [10, 20, 30] } });
  });

  it("two out-of-bounds writes collapse to one snapshot", () => {
    const { undo } = roundTrip({ arr: [1] } as Record<string, unknown>, {
      $set: { "arr.3": 7, "arr.6": 8 },
    });
    expect(undo).toEqual({ $set: { arr: [1] } });
  });

  it("absorbs a write nested inside an element", () => {
    const { undo } = roundTrip({ arr: [{ t: [1, 2] }] } as Record<string, unknown>, {
      $set: { "arr.0.t.1": 9, "arr.5": 3 },
    });
    expect(undo).toEqual({ $set: { arr: [{ t: [1, 2] }] } });
  });

  it("absorbs a granular array inverse inside an element", () => {
    const { undo } = roundTrip({ arr: [{ t: [1, 2] }] } as Record<string, unknown>, {
      $pull: { "arr.0.t": 2 },
      $push: { "arr.3": 9 },
    });
    expect(undo).toEqual({ $set: { arr: [{ t: [1, 2] }] } });
  });

  it("growth through an out-of-bounds *intermediate* index absorbs too", () => {
    const { undo } = roundTrip({ arr: [{ t: 1 }] } as Record<string, unknown>, {
      $set: { "arr.0.t": 2, "arr.4.u": 3 },
    });
    expect(undo).toEqual({ $set: { arr: [{ t: 1 }] } });
  });

  it("a scattered $pull on a nested array restores the outer array", () => {
    const { undo } = roundTrip({ arr: [{ t: [1, 2, 3] }] } as Record<string, unknown>, {
      $pull: { "arr.0.t": { $in: [1, 3] } },
    });
    expect(undo).toEqual({ $set: { arr: [{ t: [1, 2, 3] }] } });
  });

  it("absorbs an $unset entry (a field the update created inside an element)", () => {
    const { undo } = roundTrip({ arr: [{}] } as Record<string, unknown>, {
      $set: { "arr.0.x": 1, "arr.5": 2 },
    });
    expect(undo).toEqual({ $set: { arr: [{}] } });
  });
});
