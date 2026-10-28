import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { batch, createReactive, effect, unwrap } from "../../src";
import {
  applyArrayOperation,
  arrayOperationArbitrary,
  integerArbitrary,
  type ArrayOperation,
} from "../array-operations";

interface KernelState {
  count: number;
  nested: {
    score: number;
  };
  items: number[];
}

type KernelOperation =
  | { type: "setCount"; value: number }
  | { type: "setScore"; value: number }
  | ArrayOperation;

const kernelOperationArbitrary: fc.Arbitrary<KernelOperation> = fc.oneof(
  fc.record({ type: fc.constant<"setCount">("setCount"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"setScore">("setScore"), value: integerArbitrary }),
  arrayOperationArbitrary,
);

function applyKernelOperation(state: KernelState, operation: KernelOperation): void {
  switch (operation.type) {
    case "setCount": {
      state.count = operation.value;
      return;
    }
    case "setScore": {
      state.nested.score = operation.value;
      return;
    }
    default: {
      applyArrayOperation(state.items, operation);
    }
  }
}

describe("property-based direct mutations", () => {
  it("keeps reactive state aligned with plain JavaScript mutations", () => {
    fc.assert(
      fc.property(fc.array(kernelOperationArbitrary, { maxLength: 40 }), (operations) => {
        const expected: KernelState = { count: 0, nested: { score: 0 }, items: [] };
        const store = createReactive<KernelState>(structuredClone(expected));

        for (const operation of operations) {
          applyKernelOperation(expected, operation);
          applyKernelOperation(store, operation);
          expect(unwrap(store)).toEqual(expected);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("property-based batch tests", () => {
  it("fires an effect at most once for any number of writes inside a batch", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -100, max: 100 }), { minLength: 1, maxLength: 20 }),
        (values) => {
          const store = createReactive({ count: 0 });
          let callCount = 0;

          effect(() => {
            void store.count;
            callCount++;
          });

          callCount = 0;

          batch(() => {
            for (const value of values) {
              store.count = value;
            }
          });

          expect(callCount).toBeLessThanOrEqual(1);
          expect(store.count).toBe(values[values.length - 1]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("final state after batch matches sequential application of all mutations", () => {
    fc.assert(
      fc.property(
        fc.array(kernelOperationArbitrary, { minLength: 1, maxLength: 20 }),
        (operations) => {
          const expected: KernelState = { count: 0, nested: { score: 0 }, items: [] };
          const store = createReactive<KernelState>(structuredClone(expected));

          batch(() => {
            for (const operation of operations) {
              applyKernelOperation(store, operation);
              applyKernelOperation(expected, operation);
            }
          });

          expect(unwrap(store)).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("fires each tracked effect at most once per batch across multiple independent fields", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              field: fc.constant<"count">("count"),
              value: fc.integer({ min: -50, max: 50 }),
            }),
            fc.record({
              field: fc.constant<"score">("score"),
              value: fc.integer({ min: -50, max: 50 }),
            }),
          ),
          { minLength: 1, maxLength: 20 },
        ),
        (mutations) => {
          const store = createReactive({ count: 0, score: 0 });
          const countEffectFn = vi.fn(() => void store.count);
          const scoreEffectFn = vi.fn(() => void store.score);

          effect(countEffectFn);
          effect(scoreEffectFn);

          const countCallsBefore = countEffectFn.mock.calls.length;
          const scoreCallsBefore = scoreEffectFn.mock.calls.length;

          batch(() => {
            for (const mutation of mutations) {
              store[mutation.field] = mutation.value;
            }
          });

          expect(countEffectFn.mock.calls.length - countCallsBefore).toBeLessThanOrEqual(1);
          expect(scoreEffectFn.mock.calls.length - scoreCallsBefore).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
