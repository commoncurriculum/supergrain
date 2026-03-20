/**
 * README Core Examples Tests
 *
 * Tests for non-React examples from the README:
 * - Effects (DOC_TEST_37)
 * - Computed values (DOC_TEST_38)
 * - TypeScript (DOC_TEST_40)
 * - Update operators (DOC_TEST_46)
 */

import { createStore, effect, computed } from "@supergrain/core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("README Core Examples", () => {
  describe("Effects", () => {
    let localStorageMock: any;

    beforeEach(() => {
      localStorageMock = {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      Object.defineProperty(window, "localStorage", {
        value: localStorageMock,
        writable: true,
      });
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("#DOC_TEST_37", () => {
      const [state] = createStore({ count: 0 });

      const logSpy = vi.spyOn(console, "log");

      effect(() => {
        console.log("Count changed to:", state.count);
      });

      effect(() => {
        localStorage.setItem("count", String(state.count));
      });

      expect(logSpy).toHaveBeenCalledWith("Count changed to:", 0);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("count", "0");

      state.count = 5;

      expect(logSpy).toHaveBeenCalledWith("Count changed to:", 5);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("count", "5");
    });
  });

  describe("Computed Values", () => {
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("#DOC_TEST_38", () => {
      const [state] = createStore({
        todos: [
          { id: 1, text: "Task 1", completed: false },
          { id: 2, text: "Task 2", completed: true },
        ],
      });

      const completedCount = computed(() => state.todos.filter((t) => t.completed).length);

      expect(completedCount()).toBe(1);

      state.todos[0].completed = true;
      expect(completedCount()).toBe(2);
    });
  });

  describe("TypeScript", () => {
    it("#DOC_TEST_40", () => {
      interface AppState {
        user: {
          name: string;
          age: number;
          preferences: {
            theme: "light" | "dark";
            notifications: boolean;
          };
        };
        items: { id: string; title: string; count: number }[];
      }

      const [store] = createStore<AppState>({
        user: {
          name: "John",
          age: 30,
          preferences: { theme: "light", notifications: true },
        },
        items: [],
      });

      store.user.name = "Jane";
      expect(store.user.name).toBe("Jane");

      store.user.preferences.theme = "dark";
      expect(store.user.preferences.theme).toBe("dark");
    });
  });

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
