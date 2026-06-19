import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { update } from "../src";
import { applyWithUndo, undoRecorder } from "./helpers";

// Every mutating test below applies an update, asserts the forward result, then
// runs the generated `undo` and asserts the document is restored to its exact
// starting state — `rewindAndAssertRestored()` does that final assertion. Error
// cases throw, so they have no undo to verify.

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

  it("$unset: should remove a property", () => {
    const state = createReactive({
      user: { name: "John", email: "john@doe.com" },
    });
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $unset: { "user.email": 1 } });
    expect(state.user.name).toBe("John");
    expect((state.user as any).email).toBeUndefined();
    rewindAndAssertRestored();
  });

  it("$inc: should increment numeric values", () => {
    const state = createReactive({
      stats: { views: 100, likes: 50 },
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      { $inc: { "stats.views": 1, "stats.likes": -5 } },
    );
    expect(state.stats.views).toBe(101);
    expect(state.stats.likes).toBe(45);
    rewindAndAssertRestored();
  });

  it("$push: should add an element to an array", () => {
    const state = createReactive({ tags: ["a", "b"] });
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $push: { tags: "c" } });
    expect(state.tags).toEqual(["a", "b", "c"]);
    rewindAndAssertRestored();
  });

  it("$push: should add multiple elements with $each", () => {
    const state = createReactive({ tags: ["a", "b"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      { $push: { tags: { $each: ["c", "d"] } } },
    );
    expect(state.tags).toEqual(["a", "b", "c", "d"]);
    rewindAndAssertRestored();
  });

  it("$pull: should remove elements from an array by value", () => {
    const state = createReactive({ scores: [1, 2, 3, 2, 4] });
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $pull: { scores: 2 } });
    expect(state.scores).toEqual([1, 3, 4]);
    rewindAndAssertRestored();
  });

  it("$pull: should remove elements matching an object", () => {
    const state = createReactive({
      users: [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
      ],
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      { $pull: { users: { id: 1, name: "A" } } },
    );
    expect(state.users).toEqual([{ id: 2, name: "B" }]);
    rewindAndAssertRestored();
  });

  it("$pull: should invalidate array structure subscribers", () => {
    const state = createReactive({ scores: [1, 2, 3] });
    let keys: string[] = [];

    effect(() => {
      keys = Object.keys(state.scores);
    });

    expect(keys).toEqual(["0", "1", "2"]);
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $pull: { scores: 2 } });
    expect(keys).toEqual(["0", "1"]);
    rewindAndAssertRestored();
  });

  it("should handle sparse array writes and later pulls consistently", () => {
    const state = createReactive<{ scores: number[] }>({ scores: [1] });
    const rec = undoRecorder(state);

    rec.apply({}, { $set: { "scores.3": 4 } });
    expect(state.scores.length).toBe(4);
    expect(1 in state.scores).toBe(false);
    expect(state.scores[3]).toBe(4);

    rec.apply({}, { $pull: { scores: 4 } });
    expect(state.scores).toEqual([1, undefined, undefined]);

    rec.rewindAndAssertRestored();
  });

  it("should allow direct mutations and operator updates to compose on arrays", () => {
    const state = createReactive({ scores: [1, 2] });

    state.scores[0] = 3;
    const rec = undoRecorder(state);
    rec.apply({}, { $push: { scores: 4 } });
    rec.apply({}, { $pull: { scores: 2 } });

    expect(state.scores).toEqual([3, 4]);
    rec.rewindAndAssertRestored();
  });

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

  it("$addToSet: should add unique elements to an array", () => {
    const state = createReactive({ tags: ["a", "b"] });
    const rec = undoRecorder(state);
    rec.apply({}, { $addToSet: { tags: "c" } });
    expect(state.tags).toEqual(["a", "b", "c"]);
    rec.apply({}, { $addToSet: { tags: "a" } }); // Try adding a duplicate
    expect(state.tags).toEqual(["a", "b", "c"]);
    rec.rewindAndAssertRestored();
  });

  it("$addToSet: should handle $each modifier", () => {
    const state = createReactive({ tags: ["a", "b"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      { $addToSet: { tags: { $each: ["c", "a", "d"] } } },
    );
    expect(state.tags).toEqual(["a", "b", "c", "d"]);
    rewindAndAssertRestored();
  });

  it("$addToSet: should ignore duplicates inside $each", () => {
    const state = createReactive({ tags: ["a"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      {
        $addToSet: { tags: { $each: ["b", "b", "a", "c", "c"] } },
      },
    );
    expect(state.tags).toEqual(["a", "b", "c"]);
    rewindAndAssertRestored();
  });

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

  it("$min: should update if value is smaller", () => {
    const state = createReactive({ score: 100 });
    const rec = undoRecorder(state);
    rec.apply({}, { $min: { score: 150 } });
    expect(state.score).toBe(100);
    rec.apply({}, { $min: { score: 50 } });
    expect(state.score).toBe(50);
    rec.rewindAndAssertRestored();
  });

  it("$max: should update if value is larger", () => {
    const state = createReactive({ score: 100 });
    const rec = undoRecorder(state);
    rec.apply({}, { $max: { score: 50 } });
    expect(state.score).toBe(100);
    rec.apply({}, { $max: { score: 150 } });
    expect(state.score).toBe(150);
    rec.rewindAndAssertRestored();
  });

  it("should handle reactivity correctly", () => {
    const state = createReactive({ count: 0 });
    let currentCount = 0;
    const effectFn = vi.fn(() => {
      currentCount = state.count;
    });
    effect(effectFn);
    expect(currentCount).toBe(0);
    expect(effectFn).toHaveBeenCalledTimes(1);
    const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $inc: { count: 1 } });
    expect(currentCount).toBe(1);
    expect(effectFn).toHaveBeenCalledTimes(2);
    rewindAndAssertRestored();
  });

  it("should handle a complex combination of operators", () => {
    const state = createReactive<any>({
      users: [
        { id: 1, name: "Alice", profile: { views: 10, bio: "Old bio" } },
        { id: 2, name: "Bob", profile: { views: 20 } },
      ],
      meta: {
        lastUpdated: 0,
      },
    });

    const { rewindAndAssertRestored } = applyWithUndo(
      state,
      {},
      {
        $set: {
          "users.0.profile.bio": "Updated bio",
          "users.0.profile.email": "alice@example.com",
          "meta.lastUpdated": 12345,
        },
        $inc: { "users.0.profile.views": 5 },
        $rename: { "users.0.name": "users.0.fullName" },
        $unset: { "users.1.profile": 1 },
      },
    );

    const firstUser = state.users[0];
    expect((firstUser as any).name).toBeUndefined();
    expect((firstUser as any).fullName).toBe("Alice");
    expect(firstUser.profile.bio).toBe("Updated bio");
    expect(firstUser.profile.email).toBe("alice@example.com");
    expect(firstUser.profile.views).toBe(15);

    const secondUser = state.users[1];
    expect(secondUser.name).toBe("Bob");
    expect((secondUser as any).profile).toBeUndefined();

    expect(state.meta.lastUpdated).toBe(12345);
    rewindAndAssertRestored();
  });

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
});

describe("MongoDB Style Operators — validation and path creation", () => {
  it("$push/$pull on a null-valued path produces a descriptive error", () => {
    const store = createReactive<any>({ value: null });
    expect(() => update(store, {}, { $push: { value: "x" } })).toThrow(/null/i);
    expect(() => update(store, {}, { $pull: { value: "x" } })).toThrow(/null/i);
  });

  it("$inc on an array-valued path produces a descriptive error", () => {
    const store = createReactive<any>({ items: [1, 2] });
    expect(() => update(store, {}, { $inc: { items: 1 } as any })).toThrow(/array/i);
  });

  it("$push on a deep path with non-container intermediate throws 'must resolve to existing array'", () => {
    const store = createReactive<any>({ a: 42 });
    expect(() => update(store, {}, { $push: { "a.items": "x" } })).toThrow(
      /must resolve to an existing array/i,
    );
  });

  it("$addToSet deduplicates object elements using deep isEqual", () => {
    const store = createReactive<any>({ items: [{ id: 1, name: "Alice" }] });
    const rec = undoRecorder(store);
    rec.apply({}, { $addToSet: { items: { id: 1, name: "Alice" } } });
    expect(store.items).toHaveLength(1);

    rec.apply({}, { $addToSet: { items: { id: 2, name: "Bob" } } });
    expect(store.items).toHaveLength(2);

    rec.apply({}, { $addToSet: { items: { id: 1 } } });
    expect(store.items).toHaveLength(3);
    rec.rewindAndAssertRestored();
  });

  it("$addToSet handles large object values", () => {
    const keys = Array.from({ length: 50 }, (_, i) => `key${i}`);
    const obj1 = Object.fromEntries(keys.map((k) => [k, k]));
    const obj2 = Object.fromEntries(keys.map((k) => [k, k]));
    const store = createReactive<any>({ items: [obj1] });
    const rec = undoRecorder(store);

    rec.apply({}, { $addToSet: { items: obj2 } });
    expect(store.items).toHaveLength(1);

    const obj3 = { ...obj2, key0: "different" };
    rec.apply({}, { $addToSet: { items: obj3 } });
    expect(store.items).toHaveLength(2);
    rec.rewindAndAssertRestored();
  });

  it("$inc creates a new path when it does not exist", () => {
    const store = createReactive<any>({});
    const { undo, rewindAndAssertRestored } = applyWithUndo(store, {}, { $inc: { newCounter: 5 } });
    expect(store.newCounter).toBe(5);
    expect(undo).toEqual({ $unset: { newCounter: "" } });
    rewindAndAssertRestored();
  });

  it("$inc initializes existing null and undefined values", () => {
    const store = createReactive<any>({ fromNull: null, fromUndefined: undefined });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $inc: { fromNull: 3, fromUndefined: 4 } },
    );
    expect(store.fromNull).toBe(3);
    expect(store.fromUndefined).toBe(4);
    rewindAndAssertRestored();
  });

  it("$min creates a new path when it does not exist", () => {
    const store = createReactive<any>({});
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $min: { score: 10 } });
    expect(store.score).toBe(10);
    rewindAndAssertRestored();
  });

  it("$min initializes existing undefined values", () => {
    const store = createReactive<any>({ score: undefined });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $min: { score: 10 } });
    expect(store.score).toBe(10);
    rewindAndAssertRestored();
  });

  it("$max creates a new path when it does not exist", () => {
    const store = createReactive<any>({});
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $max: { score: 10 } });
    expect(store.score).toBe(10);
    rewindAndAssertRestored();
  });

  it("$max initializes existing undefined values", () => {
    const store = createReactive<any>({ score: undefined });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $max: { score: 10 } });
    expect(store.score).toBe(10);
    rewindAndAssertRestored();
  });

  it("$min and $max leave null values unchanged", () => {
    const minStore = createReactive<any>({ score: null });
    const maxStore = createReactive<any>({ score: null });

    const min = applyWithUndo(minStore, {}, { $min: { score: 10 } });
    const max = applyWithUndo(maxStore, {}, { $max: { score: 10 } });

    expect(minStore.score).toBe(null);
    expect(maxStore.score).toBe(null);
    expect(min.undo).toEqual({});
    expect(max.undo).toEqual({});
    min.rewindAndAssertRestored();
    max.rewindAndAssertRestored();
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

  it("rejects array operators when a deep parent path cannot be resolved", () => {
    const store = createReactive<any>({ a: 42 });
    expect(() => update(store, {}, { $push: { "a.b.c": "x" } })).toThrow(/must resolve/i);
  });

  it("numeric operators create missing nested paths when the parent resolver returns null", () => {
    const incStore = createReactive<any>({ a: 42 });
    const minStore = createReactive<any>({ a: 42 });
    const maxStore = createReactive<any>({ a: 42 });

    const inc = applyWithUndo(incStore, {}, { $inc: { "a.b": 1 } });
    const min = applyWithUndo(minStore, {}, { $min: { "a.c": 2 } });
    const max = applyWithUndo(maxStore, {}, { $max: { "a.d": 3 } });

    expect(incStore.a).toEqual({ b: 1 });
    expect(minStore.a).toEqual({ c: 2 });
    expect(maxStore.a).toEqual({ d: 3 });
    inc.rewindAndAssertRestored();
    min.rewindAndAssertRestored();
    max.rewindAndAssertRestored();
  });

  it("$pull mutates an untracked array without indexed subscribers", () => {
    const store = createReactive<any>({ items: [1, 2, 3] });
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $pull: { items: 2 } });
    expect(store.items).toEqual([1, 3]);
    rewindAndAssertRestored();
  });

  it("$pull can update a raw object without reactive array nodes", () => {
    const store = { items: [1, 2, 3] };
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $pull: { items: 2 } });
    expect(store.items).toEqual([1, 3]);
    rewindAndAssertRestored();
  });

  it("$pull leaves unchanged indexed signals alone", () => {
    const store = createReactive<any>({ items: [1, 2, 3] });
    let first: number | undefined;
    let third: number | undefined;
    const firstFn = vi.fn(() => {
      first = store.items[0];
    });
    const thirdFn = vi.fn(() => {
      third = store.items[2];
    });

    effect(firstFn);
    effect(thirdFn);
    expect(first).toBe(1);
    expect(third).toBe(3);
    expect(firstFn).toHaveBeenCalledTimes(1);
    expect(thirdFn).toHaveBeenCalledTimes(1);

    // After $pull(2), the array is [1, 3]: index 0 still holds 1, index 2 is
    // empty. Only the index-2 effect should be invalidated.
    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $pull: { items: 2 } });

    expect(first).toBe(1);
    expect(third).toBeUndefined();
    expect(firstFn).toHaveBeenCalledTimes(1);
    expect(thirdFn).toHaveBeenCalledTimes(2);
    rewindAndAssertRestored();
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
});

// =============================================================================
// Per-operator reactivity
//
// Each operator must produce the right reactive notifications. These pin that
// the operator dispatcher exercises the proxy contract correctly. The forward
// effect counts are asserted before `rewindAndAssertRestored()` replays the undo.
// =============================================================================

describe("MongoDB Style Operators — reactivity per operator", () => {
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

  it("$push fires effects subscribed to length and to iteration", () => {
    const store = createReactive<{ items: Array<{ id: number }> }>({
      items: [{ id: 1 }],
    });
    let length = -1;
    const lengthFn = vi.fn(() => {
      length = store.items.length;
    });
    let ids: Array<number> = [];
    const iterFn = vi.fn(() => {
      ids = store.items.map((i) => i.id);
    });
    effect(lengthFn);
    effect(iterFn);

    const { rewindAndAssertRestored } = applyWithUndo(store, {}, { $push: { items: { id: 2 } } });

    expect(length).toBe(2);
    expect(ids).toEqual([1, 2]);
    expect(lengthFn).toHaveBeenCalledTimes(2);
    expect(iterFn).toHaveBeenCalledTimes(2);
    rewindAndAssertRestored();
  });

  it("$addToSet fires effects when adding a new element and stays silent on a duplicate", () => {
    const store = createReactive({ tags: ["a", "b"] as Array<string> });
    let length = -1;
    const lengthFn = vi.fn(() => {
      length = store.tags.length;
    });
    effect(lengthFn);
    expect(length).toBe(2);
    expect(lengthFn).toHaveBeenCalledTimes(1);

    const rec = undoRecorder(store);
    rec.apply({}, { $addToSet: { tags: "c" } });
    expect(length).toBe(3);
    expect(lengthFn).toHaveBeenCalledTimes(2);

    rec.apply({}, { $addToSet: { tags: "a" } });
    expect(length).toBe(3);
    // Duplicate didn't structurally change the array — no re-run.
    expect(lengthFn).toHaveBeenCalledTimes(2);
    rec.rewindAndAssertRestored();
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

  it("$min fires only when the value actually changes", () => {
    const store = createReactive({ score: 100 });
    const fn = vi.fn(() => void store.score);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    const rec = undoRecorder(store);
    rec.apply({}, { $min: { score: 150 } }); // 150 > 100, no-op
    expect(store.score).toBe(100);
    expect(fn).toHaveBeenCalledTimes(1);

    rec.apply({}, { $min: { score: 50 } }); // 50 < 100, writes
    expect(store.score).toBe(50);
    expect(fn).toHaveBeenCalledTimes(2);
    rec.rewindAndAssertRestored();
  });

  it("$max fires only when the value actually changes", () => {
    const store = createReactive({ score: 100 });
    const fn = vi.fn(() => void store.score);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    const rec = undoRecorder(store);
    rec.apply({}, { $max: { score: 50 } }); // 50 < 100, no-op
    expect(store.score).toBe(100);
    expect(fn).toHaveBeenCalledTimes(1);

    rec.apply({}, { $max: { score: 150 } }); // 150 > 100, writes
    expect(store.score).toBe(150);
    expect(fn).toHaveBeenCalledTimes(2);
    rec.rewindAndAssertRestored();
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

  it("multi-operator update fires each affected effect at most once (batched)", () => {
    const store = createReactive({ count: 0, score: 10, items: [1, 2] });
    const countFn = vi.fn(() => void store.count);
    const scoreFn = vi.fn(() => void store.score);
    const lengthFn = vi.fn(() => void store.items.length);
    effect(countFn);
    effect(scoreFn);
    effect(lengthFn);

    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $inc: { count: 5 },
        $max: { score: 99 },
        $push: { items: 3 },
      },
    );

    expect(countFn).toHaveBeenCalledTimes(2);
    expect(scoreFn).toHaveBeenCalledTimes(2);
    expect(lengthFn).toHaveBeenCalledTimes(2);
    expect(store.count).toBe(5);
    expect(store.score).toBe(99);
    expect(store.items).toEqual([1, 2, 3]);
    rewindAndAssertRestored();
  });
});

// =============================================================================
// $pull with query conditions (standard Mongo query operators)
// =============================================================================

describe("$pull with query conditions", () => {
  it("removes elements matching an operator condition", () => {
    const store = createReactive({ nums: [1, 2, 3, 4, 5] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $pull: { nums: { $gte: 4 } } as any },
    );
    expect(store.nums).toEqual([1, 2, 3]);
    rewindAndAssertRestored();
  });

  it("removes elements matching a combined range condition", () => {
    const store = createReactive({ nums: [1, 2, 3, 4, 5] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $pull: { nums: { $gte: 2, $lte: 4 } } as any },
    );
    expect(store.nums).toEqual([1, 5]);
    rewindAndAssertRestored();
  });

  it("does not remove primitive elements when given a field condition", () => {
    const store = createReactive({ nums: [1, 2, 3] });
    const { undo, rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $pull: { nums: { foo: 1 } } as any },
    );
    expect(store.nums).toEqual([1, 2, 3]);
    expect(undo).toEqual({});
    rewindAndAssertRestored();
  });

  it("removes documents matching a field-with-operator condition", () => {
    const store = createReactive({
      tasks: [
        { id: 1, priority: 1 },
        { id: 2, priority: 5 },
        { id: 3, priority: 9 },
      ],
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $pull: { tasks: { priority: { $gte: 5 } } } as any,
      },
    );
    expect(store.tasks).toEqual([{ id: 1, priority: 1 }]);
    rewindAndAssertRestored();
  });
});

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

  it("rejects a non-number target", () => {
    const store = createReactive<any>({ price: "ten" });
    expect(() => update(store, {}, { $mul: { price: 2 } })).toThrow(/number/i);
  });
});

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

  it("rejects a non-array target", () => {
    const store = createReactive<any>({ items: 5 });
    expect(() => update(store, {}, { $pop: { items: 1 } })).toThrow(/array/i);
  });
});

// =============================================================================
// $push modifiers — $position, $slice, $sort (all standard Mongo)
// =============================================================================

describe("$push modifiers", () => {
  it("$position inserts at an index", () => {
    const store = createReactive({ items: ["a", "d"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $push: { items: { $each: ["b", "c"], $position: 1 } },
      },
    );
    expect(store.items).toEqual(["a", "b", "c", "d"]);
    rewindAndAssertRestored();
  });

  it("$position counts from the end when negative", () => {
    const store = createReactive({ items: ["a", "b", "d"] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $push: { items: { $each: ["c"], $position: -1 } },
      },
    );
    expect(store.items).toEqual(["a", "b", "c", "d"]);
    rewindAndAssertRestored();
  });

  it("$slice keeps the first N after appending", () => {
    const store = createReactive({ items: [1, 2, 3] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { items: { $each: [4, 5], $slice: 3 } } },
    );
    expect(store.items).toEqual([1, 2, 3]);
    rewindAndAssertRestored();
  });

  it("$slice with a negative count keeps the last N", () => {
    const store = createReactive({ items: [1, 2, 3] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { items: { $each: [4, 5], $slice: -2 } } },
    );
    expect(store.items).toEqual([4, 5]);
    rewindAndAssertRestored();
  });

  it("$sort orders scalar elements ascending", () => {
    const store = createReactive({ scores: [3, 1] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { scores: { $each: [2], $sort: 1 } } },
    );
    expect(store.scores).toEqual([1, 2, 3]);
    rewindAndAssertRestored();
  });

  it("$sort orders document elements by a field", () => {
    const store = createReactive({
      players: [
        { name: "A", score: 30 },
        { name: "B", score: 10 },
      ],
    });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $push: { players: { $each: [{ name: "C", score: 20 }], $sort: { score: 1 } } },
      },
    );
    expect(store.players.map((p) => p.name)).toEqual(["B", "C", "A"]);
    rewindAndAssertRestored();
  });

  it("$sort keeps equal scalar elements stable", () => {
    const store = createReactive({ scores: [2] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $push: { scores: { $each: [2], $sort: 1 } } },
    );
    expect(store.scores).toEqual([2, 2]);
    rewindAndAssertRestored();
  });

  it("$sort keeps document elements with equal keys stable", () => {
    const store = createReactive({ rows: [{ score: 5, name: "a" }] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      {
        $push: { rows: { $each: [{ score: 5, name: "b" }], $sort: { score: 1 } } },
      },
    );
    expect(store.rows.map((r) => r.score)).toEqual([5, 5]);
    rewindAndAssertRestored();
  });
});

// =============================================================================
// Deep equality across array-valued elements ($addToSet / $pullAll)
// =============================================================================

describe("deep equality of array-valued elements", () => {
  it("$addToSet treats arrays of equal length but differing items as distinct", () => {
    const store = createReactive<{ rows: Array<Array<number>> }>({ rows: [[1, 2]] });
    const rec = undoRecorder(store);

    rec.apply({}, { $addToSet: { rows: [1, 3] } });
    expect(store.rows).toEqual([
      [1, 2],
      [1, 3],
    ]);

    // An exact-length, exact-value duplicate is rejected.
    rec.apply({}, { $addToSet: { rows: [1, 2] } });
    expect(store.rows).toHaveLength(2);
    rec.rewindAndAssertRestored();
  });

  it("$addToSet treats arrays of different lengths as distinct", () => {
    const store = createReactive<{ rows: Array<Array<number>> }>({ rows: [[1, 2]] });
    const { rewindAndAssertRestored } = applyWithUndo(
      store,
      {},
      { $addToSet: { rows: [1, 2, 3] } },
    );
    expect(store.rows).toHaveLength(2);
    rewindAndAssertRestored();
  });
});
