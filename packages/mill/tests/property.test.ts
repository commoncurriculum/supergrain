import { createReactive, unwrap } from "@supergrain/kernel";
import fc from "fast-check";
import { match } from "ts-pattern";
import { describe, expect, it } from "vitest";

import { update } from "../src";
import { pathsConflict } from "../src/path";
import { recordedUpdate } from "./helpers";

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
  match(operation)
    .with({ type: "setCount" }, (op) => {
      state.count = op.value;
    })
    .with({ type: "setScore" }, (op) => {
      state.nested.score = op.value;
    })
    .with({ type: "unsetCount" }, () => {
      delete state.count;
    })
    .with({ type: "unsetScore" }, () => {
      delete state.nested.score;
    })
    .with({ type: "incCount" }, (op) => {
      state.count = incrementValue(state.count, op.value);
    })
    .with({ type: "incScore" }, (op) => {
      state.nested.score = incrementValue(state.nested.score, op.value);
    })
    .with({ type: "minCount" }, (op) => {
      state.count = minValue(state.count, op.value);
    })
    .with({ type: "minScore" }, (op) => {
      state.nested.score = minValue(state.nested.score, op.value);
    })
    .with({ type: "maxCount" }, (op) => {
      state.count = maxValue(state.count, op.value);
    })
    .with({ type: "maxScore" }, (op) => {
      state.nested.score = maxValue(state.nested.score, op.value);
    })
    .with({ type: "pushTag" }, (op) => {
      state.tags.push(op.value);
    })
    .with({ type: "pushManyTags" }, (op) => {
      state.tags.push(...op.values);
    })
    .with({ type: "pullTag" }, (op) => {
      state.tags = state.tags.filter((value) => value !== op.value);
    })
    .with({ type: "addToSetTag" }, (op) => {
      addUnique(state.tags, [op.value]);
    })
    .with({ type: "addManyToSetTags" }, (op) => {
      addUnique(state.tags, op.values);
    })
    .exhaustive();
}

function applyMillReactiveOperation(state: MillState, operation: MillOperation): void {
  match(operation)
    .with({ type: "setCount" }, (op) => recordedUpdate(state, {}, { $set: { count: op.value } }))
    .with({ type: "setScore" }, (op) =>
      recordedUpdate(state, {}, { $set: { "nested.score": op.value } }),
    )
    .with({ type: "unsetCount" }, () => recordedUpdate(state, {}, { $unset: { count: 1 } }))
    .with({ type: "unsetScore" }, () =>
      recordedUpdate(state, {}, { $unset: { "nested.score": 1 } }),
    )
    .with({ type: "incCount" }, (op) => recordedUpdate(state, {}, { $inc: { count: op.value } }))
    .with({ type: "incScore" }, (op) =>
      recordedUpdate(state, {}, { $inc: { "nested.score": op.value } }),
    )
    .with({ type: "minCount" }, (op) => recordedUpdate(state, {}, { $min: { count: op.value } }))
    .with({ type: "minScore" }, (op) =>
      recordedUpdate(state, {}, { $min: { "nested.score": op.value } }),
    )
    .with({ type: "maxCount" }, (op) => recordedUpdate(state, {}, { $max: { count: op.value } }))
    .with({ type: "maxScore" }, (op) =>
      recordedUpdate(state, {}, { $max: { "nested.score": op.value } }),
    )
    .with({ type: "pushTag" }, (op) => recordedUpdate(state, {}, { $push: { tags: op.value } }))
    .with({ type: "pushManyTags" }, (op) =>
      recordedUpdate(state, {}, { $push: { tags: { $each: op.values } } }),
    )
    .with({ type: "pullTag" }, (op) => recordedUpdate(state, {}, { $pull: { tags: op.value } }))
    .with({ type: "addToSetTag" }, (op) =>
      recordedUpdate(state, {}, { $addToSet: { tags: op.value } }),
    )
    .with({ type: "addManyToSetTags" }, (op) =>
      recordedUpdate(state, {}, { $addToSet: { tags: { $each: op.values } } }),
    )
    .exhaustive();
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
            recordedUpdate(store, {}, { $pull: { items: query } });
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
  return match(op)
    .with({ type: "set" }, (o) => {
      state[o.field] = o.value;
      return { threw: false };
    })
    .with({ type: "unset" }, (o) => {
      delete state[o.field];
      return { threw: false };
    })
    .with({ type: "rename" }, (o) => {
      if (o.from === o.to) return { threw: true }; // Mongo rejects same-field rename
      if (!(o.from in state)) return { threw: false };
      state[o.to] = state[o.from]; // overwrites an existing destination, like Mongo
      delete state[o.from];
      return { threw: false };
    })
    .exhaustive();
}

function applyRenameReactive(state: RenameState, op: RenameOp): { threw: boolean } {
  try {
    match(op)
      .with({ type: "set" }, (o) =>
        recordedUpdate(state, {}, { $set: { [o.field]: o.value } } as never),
      )
      .with({ type: "unset" }, (o) =>
        recordedUpdate(state, {}, { $unset: { [o.field]: 1 } } as never),
      )
      .with({ type: "rename" }, (o) =>
        recordedUpdate(state, {}, { $rename: { [o.from]: o.to } } as never),
      )
      .exhaustive();
    return { threw: false };
  } catch {
    return { threw: true };
  }
}

// ─── undo round-trip ─────────────────────────────────────────────────────────
//
// The defining property of the data-first undo: for any operation, applying the
// returned `undo` to the post-update document restores the exact prior state.

function operationToOps(operation: MillOperation): Record<string, unknown> {
  return match(operation)
    .with({ type: "setCount" }, (op) => ({ $set: { count: op.value } }))
    .with({ type: "setScore" }, (op) => ({ $set: { "nested.score": op.value } }))
    .with({ type: "unsetCount" }, () => ({ $unset: { count: 1 } }))
    .with({ type: "unsetScore" }, () => ({ $unset: { "nested.score": 1 } }))
    .with({ type: "incCount" }, (op) => ({ $inc: { count: op.value } }))
    .with({ type: "incScore" }, (op) => ({ $inc: { "nested.score": op.value } }))
    .with({ type: "minCount" }, (op) => ({ $min: { count: op.value } }))
    .with({ type: "minScore" }, (op) => ({ $min: { "nested.score": op.value } }))
    .with({ type: "maxCount" }, (op) => ({ $max: { count: op.value } }))
    .with({ type: "maxScore" }, (op) => ({ $max: { "nested.score": op.value } }))
    .with({ type: "pushTag" }, (op) => ({ $push: { tags: op.value } }))
    .with({ type: "pushManyTags" }, (op) => ({ $push: { tags: { $each: op.values } } }))
    .with({ type: "pullTag" }, (op) => ({ $pull: { tags: op.value } }))
    .with({ type: "addToSetTag" }, (op) => ({ $addToSet: { tags: op.value } }))
    .with({ type: "addManyToSetTags" }, (op) => ({ $addToSet: { tags: { $each: op.values } } }))
    .exhaustive();
}

describe("property-based undo round-trip", () => {
  it("applying the generated undo restores the exact prior document", () => {
    fc.assert(
      fc.property(fc.array(millOperationArbitrary, { maxLength: 40 }), (operations) => {
        const store = createReactive<MillState>({ count: 0, nested: { score: 0 }, tags: [] });

        for (const operation of operations) {
          const ops = operationToOps(operation);
          const before = structuredClone(unwrap(store));
          const { undo } = recordedUpdate(store, {}, ops as never);
          update(store, {}, undo);
          expect(unwrap(store)).toEqual(before);

          // Advance to the post-operation state for the next step in the chain
          // (raw update — the forward op was already recorded above).
          update(store, {}, ops as never);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── multi-path undo round-trip ──────────────────────────────────────────────
//
// Single-path updates can never make undo entries interact. The failure family
// this hunts is several disjoint update paths whose *undo* paths collide:
// branches the update itself creates, out-of-bounds array growth, and every
// ordering of the two. For any legal combination, the generated undo must
// itself be a legal update document (replaying must not throw) and replaying
// it must restore the exact prior document.

const pathKeyArbitrary = fc.constantFrom("a", "b", "c");
const pathSegmentArbitrary = fc.oneof(pathKeyArbitrary, fc.constantFrom("0", "1", "5"));
const pathArbitrary = fc
  .array(pathSegmentArbitrary, { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join("."));

// JSON-ish values/documents over the same tiny key alphabet, so generated
// paths sometimes traverse existing structure and sometimes create it.
const { value: valueArbitrary } = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    integerArbitrary,
    fc.array(tie("value"), { maxLength: 3 }),
    fc.dictionary(pathKeyArbitrary, tie("value"), { maxKeys: 2 }),
  ),
}));
const documentArbitrary = fc.dictionary(pathKeyArbitrary, valueArbitrary, { maxKeys: 3 });

// Keep only mutually non-conflicting paths — mill (like Mongo) rejects
// conflicting forward paths up front, which is not the behavior under test.
function keepNonConflicting(paths: ReadonlyArray<string>): Array<string> {
  const kept: Array<string> = [];
  for (const path of paths) {
    if (kept.every((existing) => !pathsConflict(existing, path))) {
      kept.push(path);
    }
  }
  return kept;
}

type MultiPathOperation = { op: "$set"; value: unknown } | { op: "$unset" };
const multiPathOperationArbitrary: fc.Arbitrary<MultiPathOperation> = fc.oneof(
  valueArbitrary.map((value) => ({ op: "$set", value }) as MultiPathOperation),
  fc.constant<MultiPathOperation>({ op: "$unset" }),
);

// A $set/$unset update document over a non-conflicting subset of paths drawn
// from `candidatePathArbitrary`, in random order.
function multiPathUpdateArbitrary(
  candidatePathArbitrary: fc.Arbitrary<string>,
): fc.Arbitrary<Record<string, Record<string, unknown>>> {
  return fc
    .uniqueArray(candidatePathArbitrary, { minLength: 1, maxLength: 4 })
    .map(keepNonConflicting)
    .chain((paths) =>
      fc
        .array(multiPathOperationArbitrary, { minLength: paths.length, maxLength: paths.length })
        .map((operations) => {
          const ops: Record<string, Record<string, unknown>> = {};
          paths.forEach((path, index) => {
            const operation = operations[index]!;
            (ops[operation.op] ??= {})[path] = operation.op === "$set" ? operation.value : 1;
          });
          return ops;
        }),
    );
}

function assertUndoRoundTrips(
  initial: Record<string, unknown>,
  ops: Record<string, Record<string, unknown>>,
): void {
  const store = createReactive<Record<string, unknown>>(structuredClone(initial));
  let undo: Record<string, unknown>;
  try {
    ({ undo } = recordedUpdate(store, {}, ops as never) as {
      undo: Record<string, unknown>;
    });
  } catch {
    // Updates this document's shape rejects (a path through a scalar or null)
    // throw in mill exactly as in Mongo — not the property under test.
    return;
  }
  update(store, {}, undo as never);
  expect(unwrap(store)).toEqual(initial);
}

describe("property-based undo round-trip — multi-path updates", () => {
  it("undo is always replayable and restores the exact prior document", () => {
    fc.assert(
      fc.property(documentArbitrary, multiPathUpdateArbitrary(pathArbitrary), (initial, ops) => {
        assertUndoRoundTrips(initial, ops);
      }),
      { numRuns: 300 },
    );
  });

  // Focused variant of the same property: sibling index writes on one array,
  // in and out of bounds, in every order. This is the shape where an
  // out-of-bounds write escalates to a whole-array restore that must absorb
  // (not conflict with) undo entries already recorded beneath it.
  it("sibling index writes on one array — in and out of bounds", () => {
    const elementArbitrary = fc.oneof(
      integerArbitrary,
      fc.record({ t: fc.array(integerArbitrary, { maxLength: 2 }) }),
    );
    const arrayDocumentArbitrary = fc
      .array(elementArbitrary, { maxLength: 4 })
      .map((arr) => ({ arr }) as Record<string, unknown>);
    const arrayPathArbitrary = fc.constantFrom(
      "arr.0",
      "arr.1",
      "arr.2",
      "arr.5",
      "arr.8",
      "arr.0.t",
      "arr.1.t.0",
      "arr.5.t",
    );
    fc.assert(
      fc.property(
        arrayDocumentArbitrary,
        multiPathUpdateArbitrary(arrayPathArbitrary),
        (initial, ops) => {
          assertUndoRoundTrips(initial, ops);
        },
      ),
      { numRuns: 300 },
    );
  });
});

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
