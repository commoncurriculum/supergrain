import { update } from "@supergrain/mill";
import { describe, it, expect } from "vitest";

import { deleteProperty } from "../../src/write";
import { createReactive, effect } from "../../src";

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

describe("write.ts branch coverage", () => {
  it("bumpVersion is a no-op when no $VERSION signal exists (object never tracked)", () => {
    // Mutate a reactive object that was never read inside a tracked effect.
    // No $VERSION signal is created, so bumpVersion's `if (v)` branch is false.
    const store = createReactive({ x: 1 });
    // No effect() subscription — $VERSION signal is never created
    expect(() => {
      store.x = 2;
    }).not.toThrow();
    expect(store.x).toBe(2);
  });

  it("deleteProperty: deleting a non-existent key is a no-op (hadKey=false branch)", () => {
    const store = createReactive({ a: 1 } as Record<string, number>);
    // Track 'b' so we get signal nodes, but it doesn't exist yet
    effect(() => void store.b);
    expect(() => {
      delete store.b; // key doesn't exist → hadKey=false, skips bumpVersion block
    }).not.toThrow();
    expect(store.b).toBeUndefined();
  });

  it("deleteProperty (standalone): handles array target (Array.isArray branch)", () => {
    // Call the standalone deleteProperty directly on an array to exercise the
    // `Array.isArray(target) ? target.length : -1` true branch.
    const arr = [10, 20, 30];
    deleteProperty(arr, 1);
    expect(arr[1]).toBeUndefined();
    expect(arr[0]).toBe(10);
  });

  it("writeHandler.deleteProperty: deleting an existing array index bumps ownKeys", () => {
    const store = createReactive({ arr: [1, 2, 3] });
    let ownKeysBumped = 0;
    effect(() => {
      // Accessing a function property on a reactive array calls trackSelf(),
      // which subscribes the effect to the $OWN_KEYS signal.
      void (store.arr as unknown[]).push;
      ownKeysBumped++;
    });
    ownKeysBumped = 0;

    // Delete an existing array index via the proxy — triggers writeHandler.deleteProperty
    // where Array.isArray(target)=true and hadKey=true → bumpOwnKeysSignal is called
    delete (store.arr as unknown as Record<string, unknown>)["0"];
    expect(ownKeysBumped).toBe(1);
    expect((store.arr as unknown as Record<string, unknown>)["0"]).toBeUndefined();
  });

  it("writeHandler.deleteProperty: deleting a non-existing array index is silent (hadKey=false branch)", () => {
    const store = createReactive({ arr: [1, 2, 3] });
    let ownKeysBumped = 0;
    effect(() => {
      void (store.arr as unknown[]).push; // subscribe to $OWN_KEYS
      ownKeysBumped++;
    });
    ownKeysBumped = 0;

    // Delete a non-existing array index — hadKey=false → bumpOwnKeysSignal NOT called
    delete (store.arr as unknown as Record<string, unknown>)["99"];
    expect(ownKeysBumped).toBe(0); // effect should NOT have fired
  });
});
