import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createReactive, unwrap } from "../../src";

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
  | { type: "push"; value: number }
  | { type: "pop" }
  | { type: "shift" }
  | { type: "unshift"; value: number }
  | { type: "setIndex"; index: number; value: number }
  | { type: "splice"; start: number; deleteCount: number; items: number[] }
  | { type: "reverse" }
  | { type: "sort" };

const integerArbitrary = fc.integer({ min: -20, max: 20 });
const itemsArbitrary = fc.array(integerArbitrary, { maxLength: 4 });

const kernelOperationArbitrary: fc.Arbitrary<KernelOperation> = fc.oneof(
  fc.record({ type: fc.constant<"setCount">("setCount"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"setScore">("setScore"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"push">("push"), value: integerArbitrary }),
  fc.constant<KernelOperation>({ type: "pop" }),
  fc.constant<KernelOperation>({ type: "shift" }),
  fc.record({ type: fc.constant<"unshift">("unshift"), value: integerArbitrary }),
  fc.record({
    type: fc.constant<"setIndex">("setIndex"),
    index: fc.integer({ min: 0, max: 20 }),
    value: integerArbitrary,
  }),
  fc.record({
    type: fc.constant<"splice">("splice"),
    start: fc.integer({ min: 0, max: 20 }),
    deleteCount: fc.integer({ min: 0, max: 20 }),
    items: itemsArbitrary,
  }),
  fc.constant<KernelOperation>({ type: "reverse" }),
  fc.constant<KernelOperation>({ type: "sort" }),
);

function normalizeIndex(index: number, length: number): number {
  return length === 0 ? 0 : ((index % length) + length) % length;
}

function normalizeSpliceStart(start: number, length: number): number {
  return ((start % (length + 1)) + (length + 1)) % (length + 1);
}

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
    case "push": {
      state.items.push(operation.value);
      return;
    }
    case "pop": {
      state.items.pop();
      return;
    }
    case "shift": {
      state.items.shift();
      return;
    }
    case "unshift": {
      state.items.unshift(operation.value);
      return;
    }
    case "setIndex": {
      const index = normalizeIndex(operation.index, state.items.length);
      state.items[index] = operation.value;
      return;
    }
    case "splice": {
      const start = normalizeSpliceStart(operation.start, state.items.length);
      const deleteCount = operation.deleteCount % (state.items.length - start + 1);
      state.items.splice(start, deleteCount, ...operation.items);
      return;
    }
    case "reverse": {
      state.items.reverse();
      return;
    }
    case "sort": {
      state.items.sort((left, right) => left - right);
      return;
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
