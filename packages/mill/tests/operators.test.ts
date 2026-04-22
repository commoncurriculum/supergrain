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
