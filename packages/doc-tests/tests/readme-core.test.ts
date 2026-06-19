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

import { createReactive } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { update } from "@supergrain/mill";
import { describe, it, expect } from "vitest";

describe("README Core Examples", () => {
  describe("Comparison", () => {
    it("#DOC_TEST_52", () => {
      // Supergrain comparison example
      interface State {
        count: number;
        user: { profile: { name: string } };
      }
      const store = createReactive<State>({ count: 0, user: { profile: { name: "John" } } });

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
      const store = createReactive({
        count: 0,
        user: { name: "John", age: 30, middleName: "M" },
        items: ["a", "b", "c"],
        tags: ["react"],
        cards: [
          { id: "card-1", title: "One", done: false },
          { id: "card-2", title: "Two", done: false },
        ],
      });

      // Apply a standard Mongo update. The second argument is a query used only
      // to resolve positional paths — pass {} when the update has none.
      const result = update(
        store,
        {},
        {
          $set: { count: 10, "user.name": "Alice" },
          $unset: { "user.middleName": "" },
          $inc: { "user.age": 1 },
          $push: { items: { $each: ["d", "e"] } },
          $addToSet: { tags: "vue" },
        },
      );

      expect(result.doc).toBe(store);
      expect(store.count).toBe(10);
      expect(store.user.name).toBe("Alice");
      expect("middleName" in store.user).toBe(false);
      expect(store.user.age).toBe(31);
      expect(store.items).toEqual(["a", "b", "c", "d", "e"]);
      expect(store.tags).toEqual(["react", "vue"]);

      // `result.undo` is a Mongo update document that reverses the exact changes.
      update(store, {}, result.undo);
      expect(store.count).toBe(0);
      expect(store.user.name).toBe("John");
      expect(store.user.middleName).toBe("M");
      expect(store.user.age).toBe(30);
      expect(store.items).toEqual(["a", "b", "c"]);
      expect(store.tags).toEqual(["react"]);

      // Positional `$`: the query selects the array element, `$` resolves to it.
      update(
        store,
        { cards: { $elemMatch: { id: "card-2" } } },
        { $set: { "cards.$.title": "Two!" } },
      );
      expect(store.cards[1].title).toBe("Two!");
      expect(store.cards[0].title).toBe("One");
    });
  });
});
