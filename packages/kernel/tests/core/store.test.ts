import { update } from "@supergrain/mill";
import { describe, it, expect, vi } from "vitest";

import { createReactive, effect, unwrap, batch } from "../../src";

describe("Store", () => {
  describe("createReactive", () => {
    it("should create a store with initial state", () => {
      const state = createReactive({ count: 0, name: "test" });
      expect(state.count).toBe(0);
      expect(state.name).toBe("test");
    });

    it("should update state with the update function", () => {
      const state = createReactive({ count: 0 });
      update(state, { $set: { count: 5 } });
      expect(state.count).toBe(5);
      update(state, { $inc: { count: 1 } });
      expect(state.count).toBe(6);
    });

    it("should handle nested objects reactively", () => {
      const state = createReactive({
        user: { address: { city: "New York" } },
      });
      let city = "";
      const effectFn = vi.fn(() => {
        city = state.user.address.city;
      });

      effect(effectFn);
      expect(city).toBe("New York");
      expect(effectFn).toHaveBeenCalledTimes(1);

      update(state, { $set: { "user.address.city": "Boston" } });
      expect(city).toBe("Boston");
      expect(effectFn).toHaveBeenCalledTimes(2);
    });

    it("should handle array updates reactively", () => {
      const state = createReactive<any>({ items: [1, 2, 3] });
      let sum = 0;
      const effectFn = vi.fn(() => {
        sum = 0;
        for (const item of state.items) {
          sum += item;
        }
      });

      effect(effectFn);
      expect(sum).toBe(6);
      expect(effectFn).toHaveBeenCalledTimes(1);

      update(state, { $set: { "items.1": 5 } });
      expect(state.items).toEqual([1, 5, 3]);
      expect(sum).toBe(9);
      expect(effectFn).toHaveBeenCalledTimes(2);

      update(state, { $set: { items: [10, 20] } });
      expect(sum).toBe(30);
      expect(effectFn).toHaveBeenCalledTimes(3);
    });

    it("should batch multiple operators in one update call", () => {
      const state = createReactive<any>({ a: 1, b: 2 });
      let sum = 0;
      const effectFn = vi.fn(() => {
        sum = state.a + state.b;
      });

      effect(effectFn);
      expect(sum).toBe(3);
      expect(effectFn).toHaveBeenCalledTimes(1);

      update(state, {
        $set: { a: 10 },
        $inc: { b: 18 },
      });

      expect(sum).toBe(30);
      expect(effectFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("Edge Cases", () => {
    it("should reject non-object root state", () => {
      expect(() => createReactive(0 as any)).toThrow(/requires the root state/i);
      expect(() => createReactive("x" as any)).toThrow(/requires the root state/i);
    });

    it("should not traverse into a frozen nested object (it's returned as-is)", () => {
      const frozen = Object.freeze({ value: 1 });
      const state = createReactive({ frozen });

      let value = 0;
      effect(() => {
        value = state.frozen.value;
      });
      expect(value).toBe(1);

      // The frozen object is the same reference passing through — it isn't
      // wrapped in a proxy. Equivalently: a successful raw mutation would not
      // be observable to the effect (we don't test that here because freezing
      // forbids the mutation, but the unwrap-equality is the contract).
      expect(unwrap(state.frozen)).toBe(frozen);
    });

    it("should handle circular references", () => {
      const obj: any = { value: 1 };
      obj.self = obj;
      const state = createReactive(obj);

      let selfValue = 0;
      const effectFn = vi.fn(() => {
        selfValue = state.self.value;
      });
      effect(effectFn);

      expect(state.value).toBe(1);
      expect(selfValue).toBe(1);
      expect(unwrap(state.self)).toBe(obj);
      // The cycle resolves to the same proxy — `state.self` is `state`.
      expect(state.self).toBe(state);

      // Mutating through the cycle propagates to subscribers tracking the
      // same property via the direct path.
      state.self.value = 2;
      expect(state.value).toBe(2);
      expect(selfValue).toBe(2);
      expect(effectFn).toHaveBeenCalledTimes(2);

      // And mutating directly propagates to subscribers tracking via the cycle.
      state.value = 3;
      expect(selfValue).toBe(3);
      expect(effectFn).toHaveBeenCalledTimes(3);
    });

    it("should handle null and undefined values reactively", () => {
      const state = createReactive<{
        nullable: string | null;
        undef: string | undefined;
      }>({
        nullable: null,
        undef: undefined,
      });

      let nullValue: string | null = null;
      let undefValue: string | undefined = undefined;
      effect(() => {
        nullValue = state.nullable;
        undefValue = state.undef;
      });

      expect(nullValue).toBe(null);
      expect(undefValue).toBe(undefined);

      update(state, { $set: { nullable: "value" } });
      expect(nullValue).toBe("value");

      update(state, { $set: { undef: "value" } });
      expect(undefValue).toBe("value");
    });

    it("should handle nested reactivity in arrays", () => {
      const state = createReactive<any>({
        users: [
          { name: "Alice", tasks: ["task1"] },
          { name: "Bob", tasks: ["task3"] },
        ],
      });

      let bobTasks: string[] = [];
      effect(() => {
        bobTasks = state.users[1]?.tasks || [];
      });

      expect(bobTasks).toEqual(["task3"]);
      update(state, { $push: { "users.1.tasks": "task4" } });
      expect(bobTasks).toEqual(["task3", "task4"]);
    });

    it("should handle adding new properties reactively", () => {
      const state = createReactive<any>({ initial: true });
      let keys: string[] = [];
      effect(() => {
        keys = Object.keys(state);
      });

      expect(keys).toEqual(["initial"]);
      update(state, { $set: { newProp: "value" } });
      expect(state.newProp).toBe("value");
      expect(keys.sort()).toEqual(["initial", "newProp"]);
    });

    it("should allow deletion of properties with $unset", () => {
      const state = createReactive<any>({ a: 1, b: 2 });
      let keys: string[] = [];
      effect(() => {
        keys = Object.keys(state);
      });
      expect(keys.sort()).toEqual(["a", "b"]);

      update(state, { $unset: { b: 1 } });
      expect(keys.sort()).toEqual(["a"]);
      expect(state.b).toBeUndefined();
    });

    it("should treat null and undefined initialState as empty object", () => {
      const stateFromNull = createReactive(null as any);
      const stateFromUndefined = createReactive(undefined as any);
      expect(typeof stateFromNull).toBe("object");
      expect(typeof stateFromUndefined).toBe("object");
    });

    it("should return proxy from cache when $PROXY cannot be defined (sealed object)", () => {
      const obj = Object.seal({ a: 1 });
      const proxy1 = createReactive(obj);
      const proxy2 = createReactive(obj);
      expect(proxy1).toBe(proxy2);

      // Sealed targets can't host the proxy's signal storage (Object.seal
      // freezes the property descriptor set), so reactivity silently
      // degrades — reads/writes pass through but subscribers don't fire.
      // We pin that behavior here so a future change can decide between
      // throwing, copying, or fully supporting sealed inputs rather than
      // accidentally regressing the silent-degrade contract.
      let observed = 0;
      const effectFn = vi.fn(() => {
        observed = proxy1.a;
      });
      effect(effectFn);
      expect(observed).toBe(1);
      expect(effectFn).toHaveBeenCalledTimes(1);

      proxy1.a = 2;
      expect(proxy1.a).toBe(2);
      expect(observed).toBe(1);
      expect(effectFn).toHaveBeenCalledTimes(1);
    });

    it("should fire the deleteProperty proxy trap for non-array objects", () => {
      const state = createReactive<any>({ a: 1, b: 2 });
      let keys: string[] = [];
      effect(() => {
        keys = Object.keys(state);
      });
      expect(keys.sort()).toEqual(["a", "b"]);
      delete state.a;
      expect(keys.sort()).toEqual(["b"]);
    });

    it("should allow deleting missing object properties without notifying subscribers", () => {
      const state = createReactive<any>({ a: 1 });
      let keys: string[] = [];
      const effectFn = vi.fn(() => {
        keys = Object.keys(state);
      });

      effect(effectFn);
      expect(keys).toEqual(["a"]);

      delete state.missing;
      expect(keys).toEqual(["a"]);
      expect(effectFn).toHaveBeenCalledTimes(1);
    });

    it("should allow deleting existing untracked properties", () => {
      const state = createReactive<any>({ a: 1 });

      delete state.a;

      expect(state.a).toBeUndefined();
      expect(Object.keys(state)).toEqual([]);
    });

    it("should signal-write on deleteProperty when the property has been read in an effect", () => {
      const state = createReactive<any>({ a: 1 });
      let value: number | undefined = 0;
      effect(() => {
        value = state.a;
      });
      expect(value).toBe(1);

      update(state, { $unset: { a: 1 } });
      expect(value).toBeUndefined();
    });

    it("should delete from an untracked array", () => {
      const state = createReactive<any>({ items: [1, 2, 3] });
      delete state.items[0];
      expect(state.items[0]).toBeUndefined();
      expect(state.items.length).toBe(3);
    });

    it("should ignore deleteProperty for a missing array index", () => {
      const state = createReactive<any>({ items: [1, 2, 3] });
      let keys: string[] = [];
      const effectFn = vi.fn(() => {
        keys = Object.keys(state.items);
      });

      effect(effectFn);
      delete state.items[99];

      expect(keys).toEqual(["0", "1", "2"]);
      expect(effectFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("batch()", () => {
    it("should throw when the callback returns a Promise", () => {
      expect(() => batch(() => Promise.resolve())).toThrow(/synchronous/i);
    });

    it("should coalesce multiple writes and fire effect once", () => {
      const state = createReactive({ a: 1, b: 2 });
      let callCount = 0;
      let sum = 0;
      effect(() => {
        callCount++;
        sum = state.a + state.b;
      });
      expect(callCount).toBe(1);

      batch(() => {
        state.a = 10;
        state.b = 20;
      });
      expect(sum).toBe(30);
      expect(callCount).toBe(2);
    });
  });
});
