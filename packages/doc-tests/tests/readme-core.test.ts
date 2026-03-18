/**
 * README Core Examples Tests
 *
 * Tests for core Storable functionality examples from the README:
 * - Creating stores (DOC_TEST_1, DOC_TEST_2)
 * - Reading state (DOC_TEST_4)
 * - Direct mutations (DOC_TEST_30)
 * - Updating state (DOC_TEST_5, DOC_TEST_11-18)
 * - Effects (DOC_TEST_19)
 * - Computed values (DOC_TEST_20)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore, effect, computed } from "@supergrain/core";

describe("README Core Examples", () => {
  describe("Creating Stores", () => {
    it("#DOC_TEST_1", () => {
      // Simple store
      const [state, update] = createStore({
        count: 0,
        name: "John",
      });

      expect(state.count).toBe(0);
      expect(state.name).toBe("John");

      // Should have update function
      expect(typeof update).toBe("function");

      // Should be able to update
      update({ $set: { count: 5 } });
      expect(state.count).toBe(5);

      update({ $set: { name: "Jane" } });
      expect(state.name).toBe("Jane");
    });

    it("#DOC_TEST_2", () => {
      // With nested objects
      const [state, update] = createStore({
        users: [
          {
            id: 1,
            name: "Alice",
            todos: [
              {
                id: 1,
                text: "Use Storable.",
                tags: [
                  {
                    id: 1,
                    title: "Urgent.",
                  },
                ],
              },
            ],
            address: {
              city: "New York",
              zip: "10001",
            },
          },
        ],
      });

      // Test initial nested state
      expect(state.users[0].name).toBe("Alice");
      expect(state.users[0].address.city).toBe("New York");
      expect(state.users[0].address.zip).toBe("10001");
      expect(state.users[0].todos).toHaveLength(1);
      expect(state.users[0].todos[0].text).toBe("Use Storable.");
      expect(state.users[0].todos[0].tags[0].title).toBe("Urgent.");

      // Test nested updates
      update({ $set: { "users.0.name": "Bob" } });
      expect(state.users[0].name).toBe("Bob");

      update({ $set: { "users.0.address.city": "Boston" } });
      expect(state.users[0].address.city).toBe("Boston");

      update({ $set: { "users.0.address.zip": "02101" } });
      expect(state.users[0].address.zip).toBe("02101");

      // Test array updates
      update({
        $push: { "users.0.todos": { id: 2, text: "Test todo", tags: [] } },
      });
      expect(state.users[0].todos).toHaveLength(2);
      expect(state.users[0].todos[1]).toEqual({
        id: 2,
        text: "Test todo",
        tags: [],
      });
    });
  });

  describe("Reading State", () => {
    it("#DOC_TEST_4", () => {
      const [state, update] = createStore({ count: 0, name: "John" });

      // You can read properties normally
      console.log(state.count); // 0
      console.log(state.name); // 'John'

      expect(state.count).toBe(0);
      expect(state.name).toBe("John");

      // Direct mutations are supported
      state.count = 5; // ✅ Works fine!
      state.name = "Jane"; // ✅ Works fine!

      expect(state.count).toBe(5);
      expect(state.name).toBe("Jane");

      // Update function also works
      update({ $set: { count: 10, name: "Bob" } });

      expect(state.count).toBe(10);
      expect(state.name).toBe("Bob");
    });
  });

  describe("Direct Mutations", () => {
    it("#DOC_TEST_30", () => {
      const [state, _update] = createStore({
        count: 0,
        user: { name: "John", age: 30 },
        items: ["a", "b", "c"],
      });

      // Direct mutations work perfectly
      state.count = 5;
      expect(state.count).toBe(5);

      state.user.name = "Jane";
      expect(state.user.name).toBe("Jane");

      state.user.age = 35;
      expect(state.user.age).toBe(35);

      state.items.push("d");
      expect(state.items).toEqual(["a", "b", "c", "d"]);
    });
  });

  describe("MongoDB-Style Operators", () => {
    it("#DOC_TEST_5", () => {
      const [state, update] = createStore({
        count: 0,
        user: { name: "John", age: 30 },
        items: ["a", "b", "c"],
      });

      // Set values
      update({ $set: { count: 5 } });
      expect(state.count).toBe(5);

      update({ $set: { "user.name": "Jane" } }); // Dot notation for nested
      expect(state.user.name).toBe("Jane");

      // Increment numbers
      update({ $inc: { count: 1 } });
      expect(state.count).toBe(6);

      update({ $inc: { "user.age": 5 } });
      expect(state.user.age).toBe(35);

      // Array operations
      update({ $push: { items: "d" } });
      expect(state.items).toEqual(["a", "b", "c", "d"]);

      update({ $pull: { items: "b" } });
      expect(state.items).toEqual(["a", "c", "d"]);

      // Multiple operations in one call (batched)
      update({
        $set: { "user.name": "Bob" },
        $inc: { count: 2 },
        $push: { items: "e" },
      });

      expect(state.user.name).toBe("Bob");
      expect(state.count).toBe(8);
      expect(state.items).toEqual(["a", "c", "d", "e"]);
    });

    it("#DOC_TEST_11", () => {
      const [state, update] = createStore({
        count: 0,
        user: { name: "John", age: 25 },
        settings: { theme: "light" },
      });

      update({ $set: { count: 10 } });
      expect(state.count).toBe(10);

      update({ $set: { "user.name": "Alice" } }); // Nested with dot notation
      expect(state.user.name).toBe("Alice");

      update({
        $set: {
          "user.name": "Bob",
          "user.age": 25,
          "settings.theme": "dark",
        },
      });

      expect(state.user.name).toBe("Bob");
      expect(state.user.age).toBe(25);
      expect(state.settings.theme).toBe("dark");
    });

    it("#DOC_TEST_12", () => {
      const [state, update] = createStore({
        temporaryField: "temp",
        user: { middleName: "Middle", name: "John" },
      });

      update({ $unset: { temporaryField: 1 } });
      expect("temporaryField" in state).toBe(false);

      update({ $unset: { "user.middleName": 1 } });
      expect("middleName" in state.user).toBe(false);
      expect(state.user.name).toBe("John"); // Other fields remain
    });

    it("#DOC_TEST_13", () => {
      const [state, update] = createStore({
        count: 0,
        stats: { views: 100 },
      });

      update({ $inc: { count: 1 } });
      expect(state.count).toBe(1);

      update({ $inc: { count: -5 } }); // Decrement
      expect(state.count).toBe(-4);

      update({ $inc: { "stats.views": 10 } });
      expect(state.stats.views).toBe(110);
    });

    it("#DOC_TEST_14", () => {
      const [state, update] = createStore({ items: ["existing"] });

      update({ $push: { items: "newItem" } });
      expect(state.items).toContain("newItem");

      // Add multiple items with $each
      update({
        $push: {
          items: { $each: ["item1", "item2", "item3"] },
        },
      });

      expect(state.items).toContain("item1");
      expect(state.items).toContain("item2");
      expect(state.items).toContain("item3");
    });

    it("#DOC_TEST_15", () => {
      const [state, update] = createStore({
        items: ["itemToRemove", "keep"],
        users: [
          { id: 123, name: "John" },
          { id: 456, name: "Jane" },
        ],
      });

      // Remove by value
      update({ $pull: { items: "itemToRemove" } });
      expect(state.items).not.toContain("itemToRemove");
      expect(state.items).toContain("keep");

      // Remove objects by matching properties
      update({
        $pull: {
          users: { id: 123, name: "John" },
        },
      });

      expect(state.users.find((u) => u.id === 123)).toBeUndefined();
      expect(state.users.find((u) => u.id === 456)).toBeDefined();
    });

    it("#DOC_TEST_16", () => {
      const [state, update] = createStore({ tags: ["existing"] });

      update({ $addToSet: { tags: "newTag" } }); // Won't add if already exists
      expect(state.tags).toContain("newTag");

      update({ $addToSet: { tags: "existing" } }); // Should not duplicate
      expect(state.tags.filter((tag) => tag === "existing")).toHaveLength(1);

      // Add multiple unique items
      update({
        $addToSet: {
          tags: { $each: ["tag1", "tag2", "tag3"] },
        },
      });

      expect(state.tags).toContain("tag1");
      expect(state.tags).toContain("tag2");
      expect(state.tags).toContain("tag3");
    });

    it("#DOC_TEST_17", () => {
      const [state, update] = createStore({
        oldFieldName: "value",
        user: { firstName: "John", lastName: "Doe" },
      });

      update({ $rename: { oldFieldName: "newFieldName" } });
      expect("oldFieldName" in state).toBe(false);
      expect((state as any).newFieldName).toBe("value");

      update({ $rename: { "user.firstName": "user.name" } });
      expect("firstName" in state.user).toBe(false);
      expect((state.user as any).name).toBe("John");
      expect(state.user.lastName).toBe("Doe");
    });

    it("#DOC_TEST_18", () => {
      const [state, update] = createStore({
        lowestScore: 100,
        highestScore: 50,
      });

      // Only updates if new value is smaller
      update({ $min: { lowestScore: 50 } });
      expect(state.lowestScore).toBe(50);

      // Only updates if new value is larger
      update({ $max: { highestScore: 100 } });
      expect(state.highestScore).toBe(100);
    });
  });

  describe("Effects and Computed Values", () => {
    let localStorageMock: any;

    beforeEach(() => {
      // Mock localStorage
      localStorageMock = {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      Object.defineProperty(window, "localStorage", {
        value: localStorageMock,
        writable: true,
      });

      // Mock console.log
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("#DOC_TEST_19", () => {
      const [state, update] = createStore({ count: 0 });

      const logSpy = vi.spyOn(console, "log");

      // This runs whenever count changes
      effect(() => {
        console.log("Count changed to:", state.count);
      });

      // Save to localStorage on change
      effect(() => {
        localStorage.setItem("count", String(state.count));
      });

      // Initial effect should run
      expect(logSpy).toHaveBeenCalledWith("Count changed to:", 0);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("count", "0");

      // Update count and verify effects run
      update({ $set: { count: 5 } });

      expect(logSpy).toHaveBeenCalledWith("Count changed to:", 5);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("count", "5");

      // Update again
      update({ $inc: { count: 1 } });

      expect(logSpy).toHaveBeenCalledWith("Count changed to:", 6);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("count", "6");
    });

    it("#DOC_TEST_20", () => {
      const [state, update] = createStore({
        todos: [
          { id: 1, text: "Task 1", completed: false },
          { id: 2, text: "Task 2", completed: true },
        ],
      });

      const completedCount = computed(() => state.todos.filter((t) => t.completed).length);

      console.log(completedCount()); // 1
      expect(completedCount()).toBe(1);

      // Updates automatically when todos change
      update({
        $set: { "todos.0.completed": true },
      });

      console.log(completedCount()); // 2
      expect(completedCount()).toBe(2);

      // Add another todo
      update({
        $push: {
          todos: { id: 3, text: "Task 3", completed: false },
        },
      });

      // Should still be 2 completed
      expect(completedCount()).toBe(2);

      // Complete the new todo
      update({
        $set: { "todos.2.completed": true },
      });

      // Now should be 3 completed
      expect(completedCount()).toBe(3);
    });
  });
});
