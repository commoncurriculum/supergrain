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

// ─── $pull on object collections ─────────────────────────────────────────────
//
// The main property test exercises $pull with primitive values. $pull also
// supports query objects against an array of objects, removing every element
// where every queried key matches by deep equality. This lives in its own
// property test because the model state shape (objects vs ints) doesn't
// compose with the main operation generator.

interface ObjectItem {
  id: number;
  category: "a" | "b" | "c";
}

interface ObjectPullState {
  items: Array<ObjectItem>;
}

const objectItemArbitrary: fc.Arbitrary<ObjectItem> = fc.record({
  id: fc.integer({ min: 0, max: 5 }),
  category: fc.constantFrom<ObjectItem["category"]>("a", "b", "c"),
});

type ObjectPullQuery = Partial<ObjectItem>;

const objectPullQueryArbitrary: fc.Arbitrary<ObjectPullQuery> = fc.oneof(
  fc.record({ id: fc.integer({ min: 0, max: 5 }) }),
  fc.record({ category: fc.constantFrom<ObjectItem["category"]>("a", "b", "c") }),
  fc.record({
    id: fc.integer({ min: 0, max: 5 }),
    category: fc.constantFrom<ObjectItem["category"]>("a", "b", "c"),
  }),
);

function modelMatches(item: ObjectItem, query: ObjectPullQuery): boolean {
  for (const key of Object.keys(query) as Array<keyof ObjectPullQuery>) {
    if (item[key] !== query[key]) return false;
  }
  return true;
}

describe("property-based $pull with object queries", () => {
  it("removes every element matching the query (deep partial match)", () => {
    fc.assert(
      fc.property(
        fc.array(objectItemArbitrary, { maxLength: 10 }),
        fc.array(objectPullQueryArbitrary, { maxLength: 5 }),
        (initial, queries) => {
          const expected: ObjectPullState = { items: structuredClone(initial) };
          const store = createReactive<ObjectPullState>({ items: structuredClone(initial) });

          for (const query of queries) {
            expected.items = expected.items.filter((item) => !modelMatches(item, query));
            update(store, { $pull: { items: query } });
            expect(unwrap(store).items).toEqual(expected.items);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── $rename ────────────────────────────────────────────────────────────────
//
// $rename moves a value from a source path to a destination path. The mill
// implementation throws when the destination already exists, so the property
// test models that — both the reference implementation and the reactive call
// must throw together (or succeed together). A property over arbitrary
// (set | rename) sequences exercises the operator across populated and empty
// source/destination configurations.

type RenameField = "alpha" | "beta";

interface RenameState {
  alpha?: number;
  beta?: number;
}

type RenameOp =
  | { type: "set"; field: RenameField; value: number }
  | { type: "unset"; field: RenameField }
  | { type: "rename"; from: RenameField; to: RenameField };

const renameOpArbitrary: fc.Arbitrary<RenameOp> = fc.oneof(
  fc.record({
    type: fc.constant<"set">("set"),
    field: fc.constantFrom<RenameField>("alpha", "beta"),
    value: fc.integer({ min: -50, max: 50 }),
  }),
  fc.record({
    type: fc.constant<"unset">("unset"),
    field: fc.constantFrom<RenameField>("alpha", "beta"),
  }),
  fc.record({
    type: fc.constant<"rename">("rename"),
    from: fc.constantFrom<RenameField>("alpha", "beta"),
    to: fc.constantFrom<RenameField>("alpha", "beta"),
  }),
);

function applyRenameModel(state: RenameState, op: RenameOp): { threw: boolean } {
  switch (op.type) {
    case "set":
      state[op.field] = op.value;
      return { threw: false };
    case "unset":
      delete state[op.field];
      return { threw: false };
    case "rename": {
      if (op.from === op.to) return { threw: false };
      if (!(op.from in state)) return { threw: false };
      if (op.to in state) return { threw: true };
      state[op.to] = state[op.from];
      delete state[op.from];
      return { threw: false };
    }
  }
}

function applyRenameReactive(state: RenameState, op: RenameOp): { threw: boolean } {
  try {
    switch (op.type) {
      case "set":
        update(state, { $set: { [op.field]: op.value } } as never);
        return { threw: false };
      case "unset":
        update(state, { $unset: { [op.field]: 1 } } as never);
        return { threw: false };
      case "rename":
        update(state, { $rename: { [op.from]: op.to } } as never);
        return { threw: false };
    }
  } catch {
    return { threw: true };
  }
}

describe("property-based $rename with set/unset/rename mix", () => {
  it("matches reference semantics including conflict-throws", () => {
    fc.assert(
      fc.property(fc.array(renameOpArbitrary, { maxLength: 25 }), (operations) => {
        const expected: RenameState = {};
        const store = createReactive<RenameState>({});

        for (const op of operations) {
          const modelOutcome = applyRenameModel(expected, op);
          const reactiveOutcome = applyRenameReactive(store, op);

          expect(reactiveOutcome.threw).toBe(modelOutcome.threw);
          expect(unwrap(store)).toEqual(expected);
        }
      }),
      { numRuns: 100 },
    );
  });
});
