import { update } from "@supergrain/mill";
import { describe, it, expect } from "vitest";

import { createReactive, effect } from "../../src";
import { deleteProperty } from "../../src/write";

describe("Direct Mutation Support", () => {
  it("should allow direct property assignment", () => {
    const store = createReactive({
      count: 0,
      user: { name: "John", age: 30 },
      items: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    // Test simple property assignment
    store.count = 42;
    expect(store.count).toBe(42);

    // Test nested property assignment
    store.user.name = "Jane";
    expect(store.user.name).toBe("Jane");

    store.user.age = 25;
    expect(store.user.age).toBe(25);

    // Test array element assignment
    store.items[0]!.label = "Updated Item 1";
    expect(store.items[0]!.label).toBe("Updated Item 1");

    // Test array element replacement
    store.items[1] = { id: 3, label: "New Item" };
    expect(store.items[1]!.id).toBe(3);
    expect(store.items[1]!.label).toBe("New Item");
  });

  it("should trigger reactivity with direct mutations", () => {
    const store = createReactive({ count: 0, user: { name: "John" } });

    let reactionCount = 0;
    let lastValue: any = null;

    // Create a simple reaction to test reactivity
    const checkReactivity = () => {
      const value = store.count;
      reactionCount++;
      lastValue = value;
      return value;
    };

    // Initial access creates dependency
    checkReactivity();
    expect(reactionCount).toBe(1);
    expect(lastValue).toBe(0);

    // Direct mutation should trigger reactivity
    store.count = 10;
    expect(store.count).toBe(10);

    // Test nested property reactivity
    let nestedReactionCount = 0;
    let lastNestedValue: any = null;

    const checkNestedReactivity = () => {
      const value = store.user.name;
      nestedReactionCount++;
      lastNestedValue = value;
      return value;
    };

    checkNestedReactivity();
    expect(nestedReactionCount).toBe(1);
    expect(lastNestedValue).toBe("John");

    store.user.name = "Jane";
    expect(store.user.name).toBe("Jane");
  });

  it("should work alongside traditional updateStore calls", () => {
    const store = createReactive({
      count: 0,
      user: { name: "John" },
      items: [{ id: 1, label: "Item 1" }],
    });

    // Use direct mutation
    store.count = 5;
    expect(store.count).toBe(5);

    // Use traditional updateStore
    update(store, { $set: { count: 10 } });
    expect(store.count).toBe(10);

    // Use direct mutation on nested property
    store.user.name = "Jane";
    expect(store.user.name).toBe("Jane");

    // Use traditional updateStore on nested property
    update(store, { $set: { "user.name": "Bob" } });
    expect(store.user.name).toBe("Bob");

    // Both approaches should work together seamlessly
    store.count = 15;
    update(store, { $set: { "user.name": "Alice" } });

    expect(store.count).toBe(15);
    expect(store.user.name).toBe("Alice");
  });

  it("should handle array mutations correctly", () => {
    const store = createReactive({
      items: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
        { id: 3, label: "Item 3" },
      ],
    });

    // Test array element property mutation
    store.items[0]!.label = "Updated Item 1";
    expect(store.items[0]!.label).toBe("Updated Item 1");

    // Test array element replacement
    store.items[1] = { id: 4, label: "Replaced Item" };
    expect(store.items[1]!.id).toBe(4);
    expect(store.items[1]!.label).toBe("Replaced Item");

    // Verify other elements unchanged
    expect(store.items[2]!.id).toBe(3);
    expect(store.items[2]!.label).toBe("Item 3");

    // Test array length is preserved
    expect(store.items.length).toBe(3);
  });

  it("should maintain type safety with direct mutations", () => {
    interface TestStore {
      count: number;
      user: { name: string; age: number };
      items: Array<{ id: number; label: string }>;
    }

    const store = createReactive<TestStore>({
      count: 0,
      user: { name: "John", age: 30 },
      items: [{ id: 1, label: "Item 1" }],
    });

    // TypeScript should allow these assignments
    store.count = 42;
    store.user.name = "Jane";
    store.user.age = 25;
    store.items[0]!.label = "Updated";

    // Verify the mutations worked
    expect(store.count).toBe(42);
    expect(store.user.name).toBe("Jane");
    expect(store.user.age).toBe(25);
    expect(store.items[0]!.label).toBe("Updated");
  });
});

describe("Direct Mutation Support — untracked writes", () => {
  it("updates an object that has not been read by an effect", () => {
    const store = createReactive({ x: 1 });
    expect(() => {
      store.x = 2;
    }).not.toThrow();
    expect(store.x).toBe(2);
  });

  it("deleting a missing object key is a no-op", () => {
    const store = createReactive({ a: 1 } as Record<string, number>);
    effect(() => void store["b"]);
    expect(() => {
      delete store["b"];
    }).not.toThrow();
    expect(store["b"]).toBeUndefined();
  });

  it("deleteProperty removes an array element without compacting the array", () => {
    const arr = [10, 20, 30];
    deleteProperty(arr, 1);
    expect(arr[1]).toBeUndefined();
    expect(arr[0]).toBe(10);
  });

  it("deleting an existing array index notifies key subscribers", () => {
    const store = createReactive({ arr: [1, 2, 3] });
    let ownKeysBumped = 0;
    effect(() => {
      void (store.arr as unknown[]).push;
      ownKeysBumped++;
    });
    ownKeysBumped = 0;

    delete (store.arr as unknown as Record<string, unknown>)["0"];
    expect(ownKeysBumped).toBe(1);
    expect((store.arr as unknown as Record<string, unknown>)["0"]).toBeUndefined();
  });

  it("deleting a missing array index is silent", () => {
    const store = createReactive({ arr: [1, 2, 3] });
    let ownKeysBumped = 0;
    effect(() => {
      void (store.arr as unknown[]).push;
      ownKeysBumped++;
    });
    ownKeysBumped = 0;

    delete (store.arr as unknown as Record<string, unknown>)["99"];
    expect(ownKeysBumped).toBe(0);
  });
});
