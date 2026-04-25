import { update } from "@supergrain/mill";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createGrain,
  effect,
  unwrap,
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
} from "../../src";
import { $VERSION } from "../../src/internal";

describe("Store", () => {
  beforeEach(() => {
    enableProfiling();
    resetProfiler();
  });

  afterEach(() => {
    disableProfiling();
  });

  describe("createGrain", () => {
    it("should create a store with initial state", () => {
      const state = createGrain({ count: 0, name: "test" });
      expect(state.count).toBe(0);
      expect(state.name).toBe("test");
    });

    it("should update state with the update function", () => {
      const state = createGrain({ count: 0 });
      update(state, { $set: { count: 5 } });
      expect(state.count).toBe(5);
      update(state, { $inc: { count: 1 } });
      expect(state.count).toBe(6);
    });

    it("should handle nested objects reactively", () => {
      const state = createGrain({
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

      const p = getProfile();
      expect(p.signalReads).toBe(6); // 3 reads × 2 runs (user, address, city)
      expect(p.signalSkips).toBe(0);
      expect(p.signalWrites).toBe(1); // city changed
    });

    it("should handle array updates reactively", () => {
      const state = createGrain<any>({ items: [1, 2, 3] });
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

      const p = getProfile();
      expect(p.signalReads).toBe(22);
      expect(p.signalSkips).toBe(9);
      expect(p.signalWrites).toBe(2);
    });

    it("should batch multiple operators in one update call", () => {
      const state = createGrain<any>({ a: 1, b: 2 });
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

      const p = getProfile();
      expect(p.signalReads).toBe(4); // 2 reads × 2 runs
      expect(p.signalSkips).toBe(0);
      expect(p.signalWrites).toBe(2); // a + b
    });
  });

  describe("Edge Cases", () => {
    it("should reject non-object root state", () => {
      expect(() => createGrain(0 as any)).toThrow(/requires the root state/i);
      expect(() => createGrain("x" as any)).toThrow(/requires the root state/i);
    });

    it("should handle frozen objects gracefully", () => {
      const frozen = Object.freeze({ value: 1 });
      const state = createGrain({ frozen });

      let value = 0;
      effect(() => {
        value = state.frozen.value;
      });
      expect(value).toBe(1);

      const p = getProfile();
      expect(p.signalReads).toBe(1); // only "frozen" prop (value is on frozen obj, no proxy)
      expect(p.signalWrites).toBe(0);
    });

    it("should handle circular references", () => {
      const obj: any = { value: 1 };
      obj.self = obj;
      const state = createGrain(obj);

      let selfValue = 0;
      effect(() => {
        selfValue = state.self.value;
      });

      expect(state.value).toBe(1);
      expect(selfValue).toBe(1);
      expect(unwrap(state.self)).toBe(obj);

      const p = getProfile();
      expect(p.signalReads).toBe(2); // self + value inside effect
      expect(p.signalSkips).toBe(2); // state.value + unwrap reads outside effect
      expect(p.signalWrites).toBe(0);
    });

    it("should handle null and undefined values reactively", () => {
      const state = createGrain<{
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

      const p = getProfile();
      expect(p.signalReads).toBe(6); // 2 reads × 3 runs (initial + 2 updates)
      expect(p.signalSkips).toBe(0);
      expect(p.signalWrites).toBe(2); // nullable + undef
    });

    it("should handle nested reactivity in arrays", () => {
      const state = createGrain<any>({
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

      const p = getProfile();
      expect(p.signalReads).toBe(3); // users, [1], tasks (initial run)
      expect(p.signalSkips).toBe(10); // reads during push + expect
      expect(p.signalWrites).toBe(0); // push doesn't write to tracked signals
    });

    it("should handle adding new properties reactively", () => {
      const state = createGrain<any>({ initial: true });
      let keys: string[] = [];
      effect(() => {
        keys = Object.keys(state);
      });

      expect(keys).toEqual(["initial"]);
      update(state, { $set: { newProp: "value" } });
      expect(state.newProp).toBe("value");
      expect(keys.sort()).toEqual(["initial", "newProp"]);

      const p = getProfile();
      expect(p.signalReads).toBe(0); // Object.keys uses ownKeys trap, not signal reads
      expect(p.signalSkips).toBe(1); // state.newProp read outside effect
      expect(p.signalWrites).toBe(1); // ownKeys signal write (new key added)
    });

    it("should allow deletion of properties with $unset", () => {
      const state = createGrain<any>({ a: 1, b: 2 });
      let keys: string[] = [];
      effect(() => {
        keys = Object.keys(state);
      });
      expect(keys.sort()).toEqual(["a", "b"]);

      update(state, { $unset: { b: 1 } });
      expect(keys.sort()).toEqual(["a"]);
      expect(state.b).toBeUndefined();

      const p = getProfile();
      expect(p.signalReads).toBe(0); // Object.keys uses ownKeys trap
      expect(p.signalSkips).toBe(1); // state.b read outside effect
      expect(p.signalWrites).toBe(1); // ownKeys signal write (key deleted)
    });

    it("should increment version for writes even before a property is tracked", () => {
      // The version signal's value is fed by a process-wide counter so the
      // specific numbers aren't meaningful — only that each write produces a
      // fresh value so `Object.is`-based signal propagation notifies
      // subscribers.
      const state = createGrain<any>({ a: 1 });

      const v0 = state[$VERSION];
      state.b = 2;
      const v1 = state[$VERSION];
      expect(v1).not.toBe(v0);

      update(state, { $set: { a: 3 } });
      const v2 = state[$VERSION];
      expect(v2).not.toBe(v1);
    });
  });
});
