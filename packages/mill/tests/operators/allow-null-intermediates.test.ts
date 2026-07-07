import { createReactive, unwrap } from "@supergrain/kernel";
import { describe, expect, it } from "vitest";

import { update, type UpdateOperations } from "../../src";

// `allowNullIntermediates` is a deliberate *departure* from MongoDB (real mongod
// throws in every case below - see rejection-parity.test.ts),
// so these tests can't go through the mongo-oracle
// helpers. They use the raw `update` and verify the round-trip by hand: apply
// with the option, assert the forward result, then apply the generated `undo`
// and assert the store is byte-for-byte back to where it started — including the
// original `null`s.
function expectRoundTrip<T extends object>(
  store: T,
  ops: UpdateOperations<T>,
  assertForward: () => void,
): void {
  const before = structuredClone(unwrap(store));
  const { undo } = update(store, {}, ops, { allowNullIntermediates: true });
  assertForward();
  update(store, {}, undo);
  expect(unwrap(store)).toEqual(before);
}

describe("allowNullIntermediates", () => {
  it("$set builds an object over a null intermediate", () => {
    const store = createReactive<any>({ attributes: { clipboard: null } });
    expectRoundTrip(store, { $set: { "attributes.clipboard.card": "c1" } }, () => {
      expect(store.attributes.clipboard).toEqual({ card: "c1" });
    });
  });

  it("$set builds objects over several consecutive null intermediates", () => {
    const store = createReactive<any>({ a: null });
    expectRoundTrip(store, { $set: { "a.b.c.d": 1 } }, () => {
      expect(store.a).toEqual({ b: { c: { d: 1 } } });
    });
  });

  it("$push creates the array when the target is null", () => {
    const store = createReactive<any>({ attributes: { cards: null } });
    expectRoundTrip(store, { $push: { "attributes.cards": { id: "x" } } }, () => {
      expect(store.attributes.cards).toEqual([{ id: "x" }]);
    });
  });

  it("$push creates arrays through a null intermediate", () => {
    const store = createReactive<any>({ attributes: null });
    expectRoundTrip(store, { $push: { "attributes.cards": 1 } }, () => {
      expect(store.attributes).toEqual({ cards: [1] });
    });
  });

  it("$addToSet creates the array when the target is null", () => {
    const store = createReactive<any>({ tags: null });
    expectRoundTrip(store, { $addToSet: { tags: { $each: ["a", "a", "b"] } } }, () => {
      expect(store.tags).toEqual(["a", "b"]);
    });
  });

  it("$inc builds objects over a null intermediate", () => {
    const store = createReactive<any>({ counters: null });
    expectRoundTrip(store, { $inc: { "counters.hits": 5 } }, () => {
      expect(store.counters).toEqual({ hits: 5 });
    });
  });

  it("$pull / $pullAll / $pop no-op on a null target (leaving the null in place)", () => {
    for (const ops of [
      { $pull: { items: 1 } },
      { $pullAll: { items: [1] } },
      { $pop: { items: 1 } },
    ] as Array<UpdateOperations<any>>) {
      const store = createReactive<any>({ items: null });
      const { undo } = update(store, {}, ops, { allowNullIntermediates: true });
      expect(store.items).toBe(null);
      expect(undo).toEqual({}); // a no-op contributes nothing to undo
    }
  });

  it("still rejects a scalar (non-null) intermediate", () => {
    const store = createReactive<any>({ a: 42 });
    expect(() =>
      update(store, {}, { $set: { "a.b": 1 } }, { allowNullIntermediates: true }),
    ).toThrow(/Cannot create field/i);
    expect(() =>
      update(store, {}, { $push: { "a.b": 1 } }, { allowNullIntermediates: true }),
    ).toThrow(/must point to an array/i);
  });

  it("is off by default: a null intermediate/target still throws like MongoDB", () => {
    const setStore = createReactive<any>({ a: null });
    expect(() => update(setStore, {}, { $set: { "a.b": 1 } })).toThrow(/Cannot create field/i);

    const pushStore = createReactive<any>({ a: null });
    expect(() => update(pushStore, {}, { $push: { a: 1 } })).toThrow(/must point to an array/i);
  });
});
