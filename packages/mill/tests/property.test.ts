import { createReactive, unwrap } from "@supergrain/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { update } from "../src";

interface MillState {
  count?: number;
  nested: {
    score?: number;
  };
  tags: number[];
}

type MillOperation =
  | { type: "setCount"; value: number }
  | { type: "setScore"; value: number }
  | { type: "unsetCount" }
  | { type: "unsetScore" }
  | { type: "incCount"; value: number }
  | { type: "incScore"; value: number }
  | { type: "minCount"; value: number }
  | { type: "minScore"; value: number }
  | { type: "maxCount"; value: number }
  | { type: "maxScore"; value: number }
  | { type: "pushTag"; value: number }
  | { type: "pushManyTags"; values: number[] }
  | { type: "pullTag"; value: number }
  | { type: "addToSetTag"; value: number }
  | { type: "addManyToSetTags"; values: number[] };

const integerArbitrary = fc.integer({ min: -20, max: 20 });
const valuesArbitrary = fc.array(integerArbitrary, { maxLength: 4 });

const millOperationArbitrary: fc.Arbitrary<MillOperation> = fc.oneof(
  fc.record({ type: fc.constant<"setCount">("setCount"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"setScore">("setScore"), value: integerArbitrary }),
  fc.constant<MillOperation>({ type: "unsetCount" }),
  fc.constant<MillOperation>({ type: "unsetScore" }),
  fc.record({ type: fc.constant<"incCount">("incCount"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"incScore">("incScore"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"minCount">("minCount"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"minScore">("minScore"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"maxCount">("maxCount"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"maxScore">("maxScore"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"pushTag">("pushTag"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"pushManyTags">("pushManyTags"), values: valuesArbitrary }),
  fc.record({ type: fc.constant<"pullTag">("pullTag"), value: integerArbitrary }),
  fc.record({ type: fc.constant<"addToSetTag">("addToSetTag"), value: integerArbitrary }),
  fc.record({
    type: fc.constant<"addManyToSetTags">("addManyToSetTags"),
    values: valuesArbitrary,
  }),
);

function incrementValue(currentValue: number | undefined, increment: number): number {
  return typeof currentValue === "number" ? currentValue + increment : increment;
}

function minValue(currentValue: number | undefined, nextValue: number): number {
  return typeof currentValue === "number" ? Math.min(currentValue, nextValue) : nextValue;
}

function maxValue(currentValue: number | undefined, nextValue: number): number {
  return typeof currentValue === "number" ? Math.max(currentValue, nextValue) : nextValue;
}

function addUnique(target: number[], values: number[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function applyMillModelOperation(state: MillState, operation: MillOperation): void {
  switch (operation.type) {
    case "setCount": {
      state.count = operation.value;
      return;
    }
    case "setScore": {
      state.nested.score = operation.value;
      return;
    }
    case "unsetCount": {
      delete state.count;
      return;
    }
    case "unsetScore": {
      delete state.nested.score;
      return;
    }
    case "incCount": {
      state.count = incrementValue(state.count, operation.value);
      return;
    }
    case "incScore": {
      state.nested.score = incrementValue(state.nested.score, operation.value);
      return;
    }
    case "minCount": {
      state.count = minValue(state.count, operation.value);
      return;
    }
    case "minScore": {
      state.nested.score = minValue(state.nested.score, operation.value);
      return;
    }
    case "maxCount": {
      state.count = maxValue(state.count, operation.value);
      return;
    }
    case "maxScore": {
      state.nested.score = maxValue(state.nested.score, operation.value);
      return;
    }
    case "pushTag": {
      state.tags.push(operation.value);
      return;
    }
    case "pushManyTags": {
      state.tags.push(...operation.values);
      return;
    }
    case "pullTag": {
      state.tags = state.tags.filter((value) => value !== operation.value);
      return;
    }
    case "addToSetTag": {
      addUnique(state.tags, [operation.value]);
      return;
    }
    case "addManyToSetTags": {
      addUnique(state.tags, operation.values);
      return;
    }
  }
}

function applyMillReactiveOperation(state: MillState, operation: MillOperation): void {
  switch (operation.type) {
    case "setCount": {
      update(state, { $set: { count: operation.value } });
      return;
    }
    case "setScore": {
      update(state, { $set: { "nested.score": operation.value } });
      return;
    }
    case "unsetCount": {
      update(state, { $unset: { count: 1 } });
      return;
    }
    case "unsetScore": {
      update(state, { $unset: { "nested.score": 1 } });
      return;
    }
    case "incCount": {
      update(state, { $inc: { count: operation.value } });
      return;
    }
    case "incScore": {
      update(state, { $inc: { "nested.score": operation.value } });
      return;
    }
    case "minCount": {
      update(state, { $min: { count: operation.value } });
      return;
    }
    case "minScore": {
      update(state, { $min: { "nested.score": operation.value } });
      return;
    }
    case "maxCount": {
      update(state, { $max: { count: operation.value } });
      return;
    }
    case "maxScore": {
      update(state, { $max: { "nested.score": operation.value } });
      return;
    }
    case "pushTag": {
      update(state, { $push: { tags: operation.value } });
      return;
    }
    case "pushManyTags": {
      update(state, { $push: { tags: { $each: operation.values } } });
      return;
    }
    case "pullTag": {
      update(state, { $pull: { tags: operation.value } });
      return;
    }
    case "addToSetTag": {
      update(state, { $addToSet: { tags: operation.value } });
      return;
    }
    case "addManyToSetTags": {
      update(state, { $addToSet: { tags: { $each: operation.values } } });
      return;
    }
  }
}

describe("property-based update operators", () => {
  it("matches plain JavaScript semantics for generated operator sequences", () => {
    fc.assert(
      fc.property(fc.array(millOperationArbitrary, { maxLength: 40 }), (operations) => {
        const expected: MillState = { count: 0, nested: { score: 0 }, tags: [] };
        const store = createReactive<MillState>(structuredClone(expected));

        for (const operation of operations) {
          applyMillModelOperation(expected, operation);
          applyMillReactiveOperation(store, operation);
          expect(unwrap(store)).toEqual(expected);
        }
      }),
      { numRuns: 100 },
    );
  });
});
