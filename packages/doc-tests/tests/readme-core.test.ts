/**
 * README Core Examples Tests
 *
 * Tests for non-React examples from the README:
 * - Synchronous state (DOC_TEST_31, DOC_TEST_33)
 * - Effects (DOC_TEST_37)
 * - Computed values (DOC_TEST_38)
 * - TypeScript (DOC_TEST_40)
 * - Update operators (DOC_TEST_46-51)
 */

import { createStore, effect, computed } from "@supergrain/core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("README Core Examples", () => {
  describe("Synchronous State", () => {
    it("#DOC_TEST_33", () => {
      // This test documents React useState behavior (the contrast Supergrain is compared to).
      // In React, useState returns a captured value that doesn't change until next render.
      let count = 0; // simulates the captured value from useState(0)
      const setCount = (_v: number) => {
        /* would schedule re-render in React */
      };

      setCount(5);
      expect(count).toBe(0); // still 0 — deferred until next render
    });

    it("#DOC_TEST_31", () => {
      const [state] = createStore({ count: 0, user: { name: "John" } });

      state.count = 5;
      expect(state.count).toBe(5);

      state.user.name = "Jane";
      expect(state.user.name).toBe("Jane");
    });
  });

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
        user: { name: "John", age: 30 },
        items: ["a", "b", "c"],
        tags: ["react"],
      });

      expect(state.count).toBe(0);
      expect(state.user.name).toBe("John");
      expect(state.items).toEqual(["a", "b", "c"]);
      expect(state.tags).toEqual(["react"]);
      expect(typeof update).toBe("function");
    });

    it("#DOC_TEST_47", () => {
      const [state, update] = createStore({
        count: 0,
        user: { name: "John", age: 30, middleName: "M" },
      });

      update({ $set: { count: 10 } });
      expect(state.count).toBe(10);

      update({ $set: { "user.name": "Alice" } });
      expect(state.user.name).toBe("Alice");

      update({ $unset: { "user.middleName": 1 } });
      expect("middleName" in state.user).toBe(false);
    });

    it("#DOC_TEST_48", () => {
      const [state, update] = createStore({ count: 0 });

      update({ $inc: { count: 1 } });
      expect(state.count).toBe(1);

      update({ $inc: { count: -5 } });
      expect(state.count).toBe(-4);
    });

    it("#DOC_TEST_49", () => {
      const [state, update] = createStore({
        items: ["a", "b", "c"],
        tags: ["react"],
      });

      update({ $push: { items: "d" } });
      expect(state.items).toContain("d");

      update({ $push: { items: { $each: ["e", "f"] } } });
      expect(state.items).toContain("e");
      expect(state.items).toContain("f");

      update({ $pull: { items: "b" } });
      expect(state.items).not.toContain("b");

      update({ $addToSet: { tags: "vue" } });
      expect(state.tags).toContain("vue");

      update({ $addToSet: { tags: "react" } }); // already present
      expect(state.tags.filter((t) => t === "react")).toHaveLength(1);
    });

    it("#DOC_TEST_50", () => {
      const [state, update] = createStore({
        oldField: "value",
        lowestScore: 100,
        highestScore: 50,
      });

      update({ $rename: { oldField: "newField" } });
      expect("oldField" in state).toBe(false);
      expect((state as any).newField).toBe("value");

      update({ $min: { lowestScore: 50 } });
      expect(state.lowestScore).toBe(50);

      update({ $max: { highestScore: 100 } });
      expect(state.highestScore).toBe(100);
    });

    it("#DOC_TEST_51", () => {
      const [state, update] = createStore({
        count: 0,
        user: { name: "John" },
        items: ["a", "b", "c"],
      });

      update({
        $set: { "user.name": "Bob" },
        $inc: { count: 2 },
        $push: { items: "g" },
      });

      expect(state.user.name).toBe("Bob");
      expect(state.count).toBe(2);
      expect(state.items).toContain("g");
    });
  });
});
