import { createReactive, effect } from "@supergrain/kernel";
import { describe, it, expect, vi } from "vitest";

import { applyWithUndo, undoRecorder } from "../helpers";

describe("MongoDB Style Operators", () => {
  it("fills gaps with null on an out-of-bounds write, then pulls consistently", () => {
    const state = createReactive<{ scores: Array<number | null> }>({ scores: [1] });
    const rec = undoRecorder(state);

    // Writing past the end grows the array; Mongo pads the gap with null.
    rec.apply({}, { $set: { "scores.3": 4 } });
    expect(state.scores).toEqual([1, null, null, 4]);

    rec.apply({}, { $pull: { scores: 4 } });
    expect(state.scores).toEqual([1, null, null]);

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

  it("should handle a complex combination of operators", () => {
    const state = createReactive<any>({
      users: [
        { id: 1, name: "Alice", profile: { views: 10, bio: "Old bio" } },
        { id: 2, name: "Bob", profile: { views: 20 } },
      ],
      meta: {
        lastUpdated: 0,
      },
      legacy: "v1",
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
        // $rename on a top-level field — Mongo forbids $rename through array elements.
        $rename: { legacy: "version" },
        $unset: { "users.1.profile": 1 },
      },
    );

    const firstUser = state.users[0];
    expect(firstUser.name).toBe("Alice");
    expect(firstUser.profile.bio).toBe("Updated bio");
    expect(firstUser.profile.email).toBe("alice@example.com");
    expect(firstUser.profile.views).toBe(15);

    const secondUser = state.users[1];
    expect(secondUser.name).toBe("Bob");
    expect((secondUser as any).profile).toBeUndefined();

    expect(state.meta.lastUpdated).toBe(12345);
    expect((state as any).legacy).toBeUndefined();
    expect(state.version).toBe("v1");
    rewindAndAssertRestored();
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
