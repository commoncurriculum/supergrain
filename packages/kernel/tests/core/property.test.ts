// Property-based coverage for the derivation layer: `computed`, `effect`, and
// the kernel's own `stableComputed`.
//
// The example tests pin specific graphs. These pin the laws those graphs are
// instances of — a derived value always equals recomputing it from scratch, a
// batch is never observed half-applied, and `stableComputed` reconciles to
// exactly what a fresh `.filter().map()` would produce, however the source got
// there.

import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { batch, computed, createReactive, effect, stableComputed, unwrap } from "../../src";

type ArrayOp =
  | { type: "push"; value: number }
  | { type: "pop" }
  | { type: "shift" }
  | { type: "unshift"; value: number }
  | { type: "set"; index: number; value: number }
  | { type: "splice"; start: number; deleteCount: number; items: Array<number> }
  | { type: "truncate"; length: number };

const valueArbitrary = fc.integer({ min: -20, max: 20 });

const arrayOpArbitrary: fc.Arbitrary<ArrayOp> = fc.oneof(
  fc.record({ type: fc.constant<"push">("push"), value: valueArbitrary }),
  fc.constant<ArrayOp>({ type: "pop" }),
  fc.constant<ArrayOp>({ type: "shift" }),
  fc.record({ type: fc.constant<"unshift">("unshift"), value: valueArbitrary }),
  fc.record({
    type: fc.constant<"set">("set"),
    index: fc.integer({ min: 0, max: 12 }),
    value: valueArbitrary,
  }),
  fc.record({
    type: fc.constant<"splice">("splice"),
    start: fc.integer({ min: 0, max: 12 }),
    deleteCount: fc.integer({ min: 0, max: 4 }),
    items: fc.array(valueArbitrary, { maxLength: 3 }),
  }),
  fc.record({ type: fc.constant<"truncate">("truncate"), length: fc.integer({ min: 0, max: 12 }) }),
);

function applyArrayOp(items: Array<number>, op: ArrayOp): void {
  switch (op.type) {
    case "push": {
      items.push(op.value);
      return;
    }
    case "pop": {
      items.pop();
      return;
    }
    case "shift": {
      items.shift();
      return;
    }
    case "unshift": {
      items.unshift(op.value);
      return;
    }
    case "set": {
      // Normalized so the op is always meaningful for the current length,
      // and never creates a hole past the end.
      if (items.length > 0) items[op.index % items.length] = op.value;
      return;
    }
    case "splice": {
      items.splice(op.start % (items.length + 1), op.deleteCount, ...op.items);
      return;
    }
    case "truncate": {
      items.length = Math.min(op.length, items.length);
      return;
    }
  }
}

/** The order-preserving transform `stableComputed` documents as its domain. */
const derive = (items: ReadonlyArray<number>): Array<number> =>
  items.filter((value) => value % 2 === 0).map((value) => value * 10);

describe("computed — always equals a from-scratch recomputation", () => {
  it("a two-input computed matches the pure function after any write sequence", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            field: fc.constantFrom<"a" | "b">("a", "b"),
            value: fc.integer({ min: -100, max: 100 }),
          }),
          { maxLength: 30 },
        ),
        (writes) => {
          const model = { a: 0, b: 0 };
          const store = createReactive({ a: 0, b: 0 });
          const sum = computed(() => store.a + store.b);

          for (const write of writes) {
            model[write.field] = write.value;
            store[write.field] = write.value;
            expect(sum()).toBe(model.a + model.b);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a chain of computeds equals the composed pure function at every step", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -50, max: 50 }), { maxLength: 30 }), (values) => {
        const store = createReactive({ n: 0 });
        const doubled = computed(() => store.n * 2);
        const plusOne = computed(() => doubled() + 1);
        const squared = computed(() => plusOne() * plusOne());

        for (const value of values) {
          store.n = value;
          expect(doubled()).toBe(value * 2);
          expect(plusOne()).toBe(value * 2 + 1);
          expect(squared()).toBe((value * 2 + 1) ** 2);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("effect — never observes a half-applied batch", () => {
  it("an invariant held at every batch boundary is never seen broken", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 20 }),
        (values) => {
          // The pair always sums to 100 outside a batch; a glitchy scheduler
          // would run the effect between the two writes and see it broken.
          const store = createReactive({ a: 0, b: 100 });
          const observed: Array<number> = [];

          effect(() => {
            observed.push(store.a + store.b);
          });

          for (const value of values) {
            batch(() => {
              store.a = value;
              store.b = 100 - value;
            });
          }

          expect(observed.every((sum) => sum === 100)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("after any batch the effect has observed the final state", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50, max: 50 }), { minLength: 1, maxLength: 20 }),
        (values) => {
          const store = createReactive({ n: 0 });
          let last = Number.NaN;

          effect(() => {
            last = store.n;
          });

          batch(() => {
            for (const value of values) store.n = value;
          });

          expect(last).toBe(values[values.length - 1]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("stableComputed — reconciles to exactly a fresh recompute", () => {
  it("contents match `.filter().map()` after any sequence of source mutations", () => {
    fc.assert(
      fc.property(
        fc.array(valueArbitrary, { maxLength: 6 }),
        fc.array(arrayOpArbitrary, { maxLength: 25 }),
        (initial, ops) => {
          const model = [...initial];
          const store = createReactive({ items: [...initial] });
          const derived = stableComputed(() => derive(store.items));

          expect([...derived()]).toEqual(derive(model));

          for (const op of ops) {
            applyArrayOp(model, op);
            applyArrayOp(store.items, op);
            expect([...derived()]).toEqual(derive(model));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("the returned reference never changes", () => {
    fc.assert(
      fc.property(
        fc.array(valueArbitrary, { maxLength: 6 }),
        fc.array(arrayOpArbitrary, { maxLength: 25 }),
        (initial, ops) => {
          const store = createReactive({ items: [...initial] });
          const derived = stableComputed(() => derive(store.items));
          const first = derived();

          for (const op of ops) {
            applyArrayOp(store.items, op);
            expect(derived()).toBe(first);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("leaves no holes — every index below length is an own slot", () => {
    fc.assert(
      fc.property(
        fc.array(valueArbitrary, { maxLength: 6 }),
        fc.array(arrayOpArbitrary, { maxLength: 20 }),
        (initial, ops) => {
          const store = createReactive({ items: [...initial] });
          const derived = stableComputed(() => derive(store.items));

          for (const op of ops) {
            applyArrayOp(store.items, op);
            const raw = unwrap(derived()) as Array<number>;
            for (let i = 0; i < raw.length; i++) {
              expect(Object.hasOwn(raw, String(i))).toBe(true);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("firewalls: a source change that leaves the derived list equal notifies nobody", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -20, max: 20 }), { minLength: 1, maxLength: 10 }),
        (odds) => {
          // Only odd values in the source, so the "evens" projection is empty
          // and stays empty no matter how the odds are rewritten.
          const source = odds.map((value) => value * 2 + 1);
          const store = createReactive({ items: [...source] });
          const derived = stableComputed(() => derive(store.items));

          const subscriber = vi.fn(() => {
            void derived().join(",");
          });
          effect(subscriber);
          const before = subscriber.mock.calls.length;

          for (let i = 0; i < store.items.length; i++) {
            store.items[i] = store.items[i]! + 2; // odd stays odd
          }

          expect(subscriber.mock.calls.length).toBe(before);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("notifies when the derived list does change", () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 20 }), (seed) => {
        const store = createReactive({ items: [1, 3, 5] });
        const derived = stableComputed(() => derive(store.items));

        const subscriber = vi.fn(() => {
          void derived().join(",");
        });
        effect(subscriber);
        const before = subscriber.mock.calls.length;

        store.items.push(seed * 2); // an even value — the projection grows

        expect(subscriber.mock.calls.length).toBeGreaterThan(before);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects a getter that does not return an array", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.string({ maxLength: 4 }),
          fc.constant(null),
          fc.constant(undefined),
          fc.dictionary(fc.string({ minLength: 1, maxLength: 2 }), fc.integer(), { maxKeys: 2 }),
        ),
        (value) => {
          const derived = stableComputed(() => value as never);
          expect(() => derived()).toThrow(TypeError);
        },
      ),
      { numRuns: 100 },
    );
  });
});
