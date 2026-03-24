/**
 * README Core Examples Tests
 *
 * Tests for non-React examples from the README:
 * - Comparison: Supergrain (DOC_TEST_52)
 * - Comparison: useState (DOC_TEST_53)
 * - Comparison: Zustand (DOC_TEST_54)
 * - Comparison: Redux/RTK (DOC_TEST_55)
 * - Comparison: MobX (DOC_TEST_56)
 * - Update operators (DOC_TEST_46)
 */

import { createStore, update } from "@supergrain/core";
import { tracked } from "@supergrain/react";
import { describe, it, expect } from "vitest";

describe("README Core Examples", () => {
  describe("Comparison", () => {
    it("#DOC_TEST_52", () => {
      // Supergrain comparison example
      interface State {
        count: number;
        user: { profile: { name: string } };
      }
      const store = createStore<State>({ count: 0, user: { profile: { name: "John" } } });

      store.count = 5;
      expect(store.count).toBe(5);

      store.user.profile.name = "Bob";
      expect(store.user.profile.name).toBe("Bob");

      // Fine-grained — tracked() creates a component subscribed to store.count
      expect(typeof tracked).toBe("function");
    });

    it("#DOC_TEST_53", () => {
      // useState comparison — demonstrates the spreading pattern
      interface State {
        count: number;
        user: { profile: { name: string } };
      }
      const state: State = { count: 0, user: { profile: { name: "John" } } };

      // Simulates setState spreading for mutation
      const updated = { ...state, count: 5 };
      expect(updated.count).toBe(5);

      // Deep nested requires manual spreading
      const deepUpdated = {
        ...state,
        user: { ...state.user, profile: { ...state.user.profile, name: "Bob" } },
      };
      expect(deepUpdated.user.profile.name).toBe("Bob");
    });

    it("#DOC_TEST_54", () => {
      // Zustand comparison — same spreading pattern for nested updates
      interface State {
        count: number;
        user: { profile: { name: string } };
      }
      const state: State = { count: 0, user: { profile: { name: "John" } } };

      // Zustand set() with spreading
      const updated = { count: 5 };
      expect(updated.count).toBe(5);

      // Deep nested — manual spreading required
      const deepUpdated = {
        user: { ...state.user, profile: { ...state.user.profile, name: "Bob" } },
      };
      expect(deepUpdated.user.profile.name).toBe("Bob");
    });

    it("#DOC_TEST_55", () => {
      // Redux/RTK comparison — reducers for each mutation
      interface State {
        count: number;
        user: { profile: { name: string } };
      }
      const initialState: State = { count: 0, user: { profile: { name: "John" } } };

      // Simulates Immer-style reducer
      const state = { ...initialState };
      state.count = 5;
      expect(state.count).toBe(5);

      state.user.profile.name = "Bob";
      expect(state.user.profile.name).toBe("Bob");
    });

    it("#DOC_TEST_56", () => {
      // MobX comparison — class-based store
      class AppStore {
        count = 0;
        user = { profile: { name: "John" } };
      }
      const store = new AppStore();

      store.count = 5;
      expect(store.count).toBe(5);

      store.user.profile.name = "Bob";
      expect(store.user.profile.name).toBe("Bob");
    });
  });

  describe("Update Operators", () => {
    it("#DOC_TEST_46", () => {
      const state = createStore({
        count: 0,
        user: { name: "John", age: 30, middleName: "M" },
        items: ["a", "b", "c"],
        tags: ["react"],
        lowestScore: 100,
        highestScore: 50,
      });

      // $set
      update(state, { $set: { count: 10, "user.name": "Alice" } });
      expect(state.count).toBe(10);
      expect(state.user.name).toBe("Alice");

      // $unset
      update(state, { $unset: { "user.middleName": 1 } });
      expect("middleName" in state.user).toBe(false);

      // $inc
      update(state, { $inc: { count: 1 } });
      expect(state.count).toBe(11);
      update(state, { $inc: { count: -5 } });
      expect(state.count).toBe(6);

      // $push
      update(state, { $push: { items: "d" } });
      expect(state.items).toContain("d");
      update(state, { $push: { items: { $each: ["e", "f"] } } });
      expect(state.items).toContain("e");
      expect(state.items).toContain("f");

      // $pull
      update(state, { $pull: { items: "b" } });
      expect(state.items).not.toContain("b");

      // $addToSet
      update(state, { $addToSet: { tags: "vue" } });
      expect(state.tags).toContain("vue");

      // $min / $max
      update(state, { $min: { lowestScore: 50 } });
      expect(state.lowestScore).toBe(50);
      update(state, { $max: { highestScore: 100 } });
      expect(state.highestScore).toBe(100);

      // Batching
      update(state, {
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
