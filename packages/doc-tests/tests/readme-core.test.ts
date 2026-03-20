/**
 * README Core Examples Tests
 *
 * Tests for non-React examples from the README:
 * - Update operators (DOC_TEST_46)
 */

import { createStore } from "@supergrain/core";
import { describe, it, expect } from "vitest";

describe("README Core Examples", () => {
  describe("Update Operators", () => {
    it("#DOC_TEST_46", () => {
      const [state, update] = createStore({
        count: 0,
        user: { name: "John", age: 30, middleName: "M" },
        items: ["a", "b", "c"],
        tags: ["react"],
        lowestScore: 100,
        highestScore: 50,
      });

      // $set
      update({ $set: { count: 10, "user.name": "Alice" } });
      expect(state.count).toBe(10);
      expect(state.user.name).toBe("Alice");

      // $unset
      update({ $unset: { "user.middleName": 1 } });
      expect("middleName" in state.user).toBe(false);

      // $inc
      update({ $inc: { count: 1 } });
      expect(state.count).toBe(11);
      update({ $inc: { count: -5 } });
      expect(state.count).toBe(6);

      // $push
      update({ $push: { items: "d" } });
      expect(state.items).toContain("d");
      update({ $push: { items: { $each: ["e", "f"] } } });
      expect(state.items).toContain("e");
      expect(state.items).toContain("f");

      // $pull
      update({ $pull: { items: "b" } });
      expect(state.items).not.toContain("b");

      // $addToSet
      update({ $addToSet: { tags: "vue" } });
      expect(state.tags).toContain("vue");

      // $min / $max
      update({ $min: { lowestScore: 50 } });
      expect(state.lowestScore).toBe(50);
      update({ $max: { highestScore: 100 } });
      expect(state.highestScore).toBe(100);

      // Batching
      update({
        $set: { "user.name": "Bob" },
        $inc: { count: 2 },
        $push: { items: "g" },
      });
      expect(state.user.name).toBe("Bob");
      expect(state.count).toBe(8);
      expect(state.items).toContain("g");
    });
  });
});
