import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { update } from "../src";

describe("MongoDB Style Operators", () => {
  it("$set: should set top-level and nested properties", () => {
    const state = createReactive({
      user: { name: "John", address: { city: "New York" } },
    });
    update(state, {
      $set: { "user.name": "Jane", "user.address.city": "Boston" },
    });
    expect(state.user.name).toBe("Jane");
    expect(state.user.address.city).toBe("Boston");
  });

  it("$unset: should remove a property", () => {
    const state = createReactive({
      user: { name: "John", email: "john@doe.com" },
    });
    update(state, { $unset: { "user.email": 1 } });
    expect(state.user.name).toBe("John");
    expect((state.user as any).email).toBeUndefined();
  });

  it("$inc: should increment numeric values", () => {
    const state = createReactive({
      stats: { views: 100, likes: 50 },
    });
    update(state, { $inc: { "stats.views": 1, "stats.likes": -5 } });
    expect(state.stats.views).toBe(101);
    expect(state.stats.likes).toBe(45);
  });

  it("$push: should add an element to an array", () => {
    const state = createReactive({ tags: ["a", "b"] });
    update(state, { $push: { tags: "c" } });
    expect(state.tags).toEqual(["a", "b", "c"]);
  });

  it("$push: should add multiple elements with $each", () => {
    const state = createReactive({ tags: ["a", "b"] });
    update(state, { $push: { tags: { $each: ["c", "d"] } } });
    expect(state.tags).toEqual(["a", "b", "c", "d"]);
  });

  it("$pull: should remove elements from an array by value", () => {
    const state = createReactive({ scores: [1, 2, 3, 2, 4] });
    update(state, { $pull: { scores: 2 } });
    expect(state.scores).toEqual([1, 3, 4]);
  });

  it("$pull: should remove elements matching an object", () => {
    const state = createReactive({
      users: [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
      ],
    });
    update(state, { $pull: { users: { id: 1, name: "A" } } });
    expect(state.users).toEqual([{ id: 2, name: "B" }]);
  });

  it("$pull: should invalidate array structure subscribers", () => {
    const state = createReactive({ scores: [1, 2, 3] });
    let keys: string[] = [];

    effect(() => {
      keys = Object.keys(state.scores);
    });

    expect(keys).toEqual(["0", "1", "2"]);
    update(state, { $pull: { scores: 2 } });
    expect(keys).toEqual(["0", "1"]);
  });

  it("should handle sparse array writes and later pulls consistently", () => {
    const state = createReactive<{ scores: number[] }>({ scores: [1] });

    update(state, { $set: { "scores.3": 4 } });
    expect(state.scores.length).toBe(4);
    expect(1 in state.scores).toBe(false);
    expect(state.scores[3]).toBe(4);

    update(state, { $pull: { scores: 4 } });
    expect(state.scores).toEqual([1, undefined, undefined]);
  });

  it("should allow direct mutations and operator updates to compose on arrays", () => {
    const state = createReactive({ scores: [1, 2] });

    state.scores[0] = 3;
    update(state, { $push: { scores: 4 } });
    update(state, { $pull: { scores: 2 } });

    expect(state.scores).toEqual([3, 4]);
  });

  it("$addToSet: should add unique elements to an array", () => {
    const state = createReactive({ tags: ["a", "b"] });
    update(state, { $addToSet: { tags: "c" } });
    expect(state.tags).toEqual(["a", "b", "c"]);
    update(state, { $addToSet: { tags: "a" } }); // Try adding a duplicate
    expect(state.tags).toEqual(["a", "b", "c"]);
  });

  it("$addToSet: should handle $each modifier", () => {
    const state = createReactive({ tags: ["a", "b"] });
    update(state, { $addToSet: { tags: { $each: ["c", "a", "d"] } } });
    expect(state.tags).toEqual(["a", "b", "c", "d"]);
  });

  it("$addToSet: should ignore duplicates inside $each", () => {
    const state = createReactive({ tags: ["a"] });
    update(state, { $addToSet: { tags: { $each: ["b", "b", "a", "c", "c"] } } });
    expect(state.tags).toEqual(["a", "b", "c"]);
  });

  it("$rename: should rename fields", () => {
    const state = createReactive<any>({
      user: { name: "John", address: { street: "123 Main St" } },
    });
    update(state, { $rename: { "user.name": "user.fullName" } });
    update(state, { $rename: { "user.address": "user.location" } });
    expect((state.user as any).name).toBeUndefined();
    expect((state.user as any).fullName).toBe("John");
    expect((state.user as any).address).toBeUndefined();
    expect((state.user as any).location).toEqual({ street: "123 Main St" });
  });

  it("$min: should update if value is smaller", () => {
    const state = createReactive({ score: 100 });
    update(state, { $min: { score: 150 } });
    expect(state.score).toBe(100);
    update(state, { $min: { score: 50 } });
    expect(state.score).toBe(50);
  });

  it("$max: should update if value is larger", () => {
    const state = createReactive({ score: 100 });
    update(state, { $max: { score: 50 } });
    expect(state.score).toBe(100);
    update(state, { $max: { score: 150 } });
    expect(state.score).toBe(150);
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
    update(state, { $inc: { count: 1 } });
    expect(currentCount).toBe(1);
    expect(effectFn).toHaveBeenCalledTimes(2);
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

    update(state, {
      $set: {
        "users.0.profile.bio": "Updated bio",
        "users.0.profile.email": "alice@example.com",
        "meta.lastUpdated": 12345,
      },
      $inc: { "users.0.profile.views": 5 },
      $rename: { "users.0.name": "users.0.fullName" },
      $unset: { "users.1.profile": 1 },
    });

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
  });

  it("should reject empty or malformed update paths", () => {
    const state = createReactive({ user: { name: "John" } });

    expect(() => update(state, { $set: { "": "Jane" } as any })).toThrow(/must not be empty/i);
    expect(() => update(state, { $set: { "user..name": "Jane" } as any })).toThrow(
      /empty path segments/i,
    );
    expect(state.user.name).toBe("John");
  });

  it("should reject array operators on non-array paths", () => {
    const store = createReactive({ user: { name: "John" } });

    expect(() => update(store, { $push: { user: "x" } as any })).toThrow(/array/i);
    expect(() => update(store, { $pull: { user: "x" } as any })).toThrow(/array/i);
    expect(() => update(store, { $addToSet: { user: "x" } as any })).toThrow(/array/i);
  });

  it("should reject numeric operators on non-number paths", () => {
    const store = createReactive({ user: { name: "John" } });

    expect(() => update(store, { $inc: { "user.name": 1 } as any })).toThrow(/number/i);
    expect(() => update(store, { $min: { "user.name": 1 } as any })).toThrow(/number/i);
    expect(() => update(store, { $max: { "user.name": 1 } as any })).toThrow(/number/i);
  });

  it("should reject conflicting rename destinations", () => {
    const state = createReactive({
      user: { firstName: "John", fullName: "John Doe" },
    });

    expect(() => update(state, { $rename: { "user.firstName": "user.fullName" } })).toThrow(
      /already exists/i,
    );
    expect(state.user.firstName).toBe("John");
    expect(state.user.fullName).toBe("John Doe");
  });
});

describe("MongoDB Style Operators — validation and path creation", () => {
  it("$push/$pull on a null-valued path produces a descriptive error", () => {
    const store = createReactive<any>({ value: null });
    expect(() => update(store, { $push: { value: "x" } })).toThrow(/null/i);
    expect(() => update(store, { $pull: { value: "x" } })).toThrow(/null/i);
  });

  it("$inc on an array-valued path produces a descriptive error", () => {
    const store = createReactive<any>({ items: [1, 2] });
    expect(() => update(store, { $inc: { items: 1 } as any })).toThrow(/array/i);
  });

  it("$push on a deep path with non-container intermediate throws 'must resolve to existing array'", () => {
    const store = createReactive<any>({ a: 42 });
    expect(() => update(store, { $push: { "a.items": "x" } })).toThrow(
      /must resolve to an existing array/i,
    );
  });

  it("$addToSet deduplicates object elements using deep isEqual", () => {
    const store = createReactive<any>({ items: [{ id: 1, name: "Alice" }] });
    update(store, { $addToSet: { items: { id: 1, name: "Alice" } } });
    expect(store.items).toHaveLength(1);

    update(store, { $addToSet: { items: { id: 2, name: "Bob" } } });
    expect(store.items).toHaveLength(2);

    update(store, { $addToSet: { items: { id: 1 } } });
    expect(store.items).toHaveLength(3);
  });

  it("$addToSet handles large object values", () => {
    const keys = Array.from({ length: 50 }, (_, i) => `key${i}`);
    const obj1 = Object.fromEntries(keys.map((k) => [k, k]));
    const obj2 = Object.fromEntries(keys.map((k) => [k, k]));
    const store = createReactive<any>({ items: [obj1] });

    update(store, { $addToSet: { items: obj2 } });
    expect(store.items).toHaveLength(1);

    const obj3 = { ...obj2, key0: "different" };
    update(store, { $addToSet: { items: obj3 } });
    expect(store.items).toHaveLength(2);
  });

  it("$inc creates a new path when it does not exist", () => {
    const store = createReactive<any>({});
    update(store, { $inc: { newCounter: 5 } });
    expect(store.newCounter).toBe(5);
  });

  it("$inc initializes existing null and undefined values", () => {
    const store = createReactive<any>({ fromNull: null, fromUndefined: undefined });
    update(store, { $inc: { fromNull: 3, fromUndefined: 4 } });
    expect(store.fromNull).toBe(3);
    expect(store.fromUndefined).toBe(4);
  });

  it("$min creates a new path when it does not exist", () => {
    const store = createReactive<any>({});
    update(store, { $min: { score: 10 } });
    expect(store.score).toBe(10);
  });

  it("$min initializes existing undefined values", () => {
    const store = createReactive<any>({ score: undefined });
    update(store, { $min: { score: 10 } });
    expect(store.score).toBe(10);
  });

  it("$max creates a new path when it does not exist", () => {
    const store = createReactive<any>({});
    update(store, { $max: { score: 10 } });
    expect(store.score).toBe(10);
  });

  it("$max initializes existing undefined values", () => {
    const store = createReactive<any>({ score: undefined });
    update(store, { $max: { score: 10 } });
    expect(store.score).toBe(10);
  });

  it("$min and $max leave null values unchanged", () => {
    const minStore = createReactive<any>({ score: null });
    const maxStore = createReactive<any>({ score: null });

    update(minStore, { $min: { score: 10 } });
    update(maxStore, { $max: { score: 10 } });

    expect(minStore.score).toBe(null);
    expect(maxStore.score).toBe(null);
  });

  it("$set creates missing nested paths", () => {
    const store = createReactive<any>({});
    update(store, { $set: { "brand.new.path": "value" } });
    expect(store.brand.new.path).toBe("value");
  });

  it("rejects array operators when a deep parent path cannot be resolved", () => {
    const store = createReactive<any>({ a: 42 });
    expect(() => update(store, { $push: { "a.b.c": "x" } })).toThrow(/must resolve/i);
  });

  it("numeric operators create missing nested paths when the parent resolver returns null", () => {
    const incStore = createReactive<any>({ a: 42 });
    const minStore = createReactive<any>({ a: 42 });
    const maxStore = createReactive<any>({ a: 42 });

    update(incStore, { $inc: { "a.b": 1 } });
    update(minStore, { $min: { "a.c": 2 } });
    update(maxStore, { $max: { "a.d": 3 } });

    expect(incStore.a).toEqual({ b: 1 });
    expect(minStore.a).toEqual({ c: 2 });
    expect(maxStore.a).toEqual({ d: 3 });
  });

  it("$pull mutates an untracked array without indexed subscribers", () => {
    const store = createReactive<any>({ items: [1, 2, 3] });
    update(store, { $pull: { items: 2 } });
    expect(store.items).toEqual([1, 3]);
  });

  it("$pull can update a raw object without reactive array nodes", () => {
    const store = { items: [1, 2, 3] };
    update(store, { $pull: { items: 2 } });
    expect(store.items).toEqual([1, 3]);
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
    update(store, { $pull: { items: 2 } });

    expect(first).toBe(1);
    expect(third).toBeUndefined();
    expect(firstFn).toHaveBeenCalledTimes(1);
    expect(thirdFn).toHaveBeenCalledTimes(2);
  });

  it("$rename ignores missing source paths", () => {
    const store = createReactive<any>({ user: { name: "Jane" } });
    update(store, { $rename: { "user.missing": "user.other" } });
    expect(store.user).toEqual({ name: "Jane" });
  });
});

// =============================================================================
// Per-operator reactivity
//
// Each operator must produce the right reactive notifications. The shared
// kernel test suite covers the proxy contract for direct mutations; these
// tests pin that the *operator dispatcher* in mill exercises that contract
// correctly for every kind of operator. Sparse pre-existing coverage (just
// $inc and $pull) was leaving the rest unverified.
// =============================================================================

describe("MongoDB Style Operators — reactivity per operator", () => {
  it("$set fires effects subscribed to the written path and not to siblings", () => {
    const store = createReactive({ a: 1, b: 2 });
    const aFn = vi.fn(() => store.a);
    const bFn = vi.fn(() => store.b);
    effect(aFn);
    effect(bFn);

    update(store, { $set: { a: 10 } });

    expect(store.a).toBe(10);
    expect(aFn).toHaveBeenCalledTimes(2);
    expect(bFn).toHaveBeenCalledTimes(1);
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

    update(store, { $unset: { b: 1 } });

    expect(observedB).toBeUndefined();
    expect(bFn).toHaveBeenCalledTimes(2);
    expect(keys).toEqual(["a"]);
    expect(keysFn).toHaveBeenCalledTimes(2);
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

    update(store, { $push: { items: { id: 2 } } });

    expect(length).toBe(2);
    expect(ids).toEqual([1, 2]);
    expect(lengthFn).toHaveBeenCalledTimes(2);
    expect(iterFn).toHaveBeenCalledTimes(2);
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

    update(store, { $addToSet: { tags: "c" } });
    expect(length).toBe(3);
    expect(lengthFn).toHaveBeenCalledTimes(2);

    update(store, { $addToSet: { tags: "a" } });
    expect(length).toBe(3);
    // Duplicate didn't structurally change the array — no re-run.
    expect(lengthFn).toHaveBeenCalledTimes(2);
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

    update(store, { $rename: { "user.name": "user.fullName" } });

    expect(store.user.name).toBeUndefined();
    expect(store.user.fullName).toBe("John");
    expect(name).toBeUndefined();
    expect(fullName).toBe("John");
    expect(nameFn).toHaveBeenCalledTimes(2);
    expect(fullNameFn).toHaveBeenCalledTimes(2);
  });

  it("$min fires only when the value actually changes", () => {
    const store = createReactive({ score: 100 });
    const fn = vi.fn(() => store.score);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    update(store, { $min: { score: 150 } }); // 150 > 100, no-op
    expect(store.score).toBe(100);
    expect(fn).toHaveBeenCalledTimes(1);

    update(store, { $min: { score: 50 } }); // 50 < 100, writes
    expect(store.score).toBe(50);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("$max fires only when the value actually changes", () => {
    const store = createReactive({ score: 100 });
    const fn = vi.fn(() => store.score);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    update(store, { $max: { score: 50 } }); // 50 < 100, no-op
    expect(store.score).toBe(100);
    expect(fn).toHaveBeenCalledTimes(1);

    update(store, { $max: { score: 150 } }); // 150 > 100, writes
    expect(store.score).toBe(150);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("multi-operator update fires each affected effect at most once (batched)", () => {
    const store = createReactive({ count: 0, score: 10, items: [1, 2] });
    const countFn = vi.fn(() => store.count);
    const scoreFn = vi.fn(() => store.score);
    const lengthFn = vi.fn(() => store.items.length);
    effect(countFn);
    effect(scoreFn);
    effect(lengthFn);

    update(store, {
      $inc: { count: 5 },
      $max: { score: 99 },
      $push: { items: 3 },
    });

    expect(countFn).toHaveBeenCalledTimes(2);
    expect(scoreFn).toHaveBeenCalledTimes(2);
    expect(lengthFn).toHaveBeenCalledTimes(2);
    expect(store.count).toBe(5);
    expect(store.score).toBe(99);
    expect(store.items).toEqual([1, 2, 3]);
  });
});
