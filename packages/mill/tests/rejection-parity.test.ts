import { describe, expect, it } from "vitest";

import { update as millUpdate } from "../src";
import { runMongoUpdate } from "./mongo-oracle";

// Every *successful* mutating test is already validated against real mongod via
// the global afterEach (see ./mongo-oracle.ts). This file covers the other half:
// inputs MongoDB *rejects*. For each, mill must throw and so must real mongod —
// a type error mill silently accepted (or one it invented) would be a bug.

interface RejectionCase {
  name: string;
  doc: Record<string, unknown>;
  ops: Record<string, unknown>;
}

const cases: Array<RejectionCase> = [
  { name: "$push onto a number", doc: { a: 5 }, ops: { $push: { a: 1 } } },
  { name: "$push onto a string", doc: { a: "x" }, ops: { $push: { a: 1 } } },
  { name: "$push onto null", doc: { a: null }, ops: { $push: { a: 1 } } },
  { name: "$push within null", doc: { a: null }, ops: { $push: { "a.b": 1 } } },
  { name: "$inc on a string", doc: { a: "x" }, ops: { $inc: { a: 1 } } },
  { name: "$mul on a string", doc: { a: "x" }, ops: { $mul: { a: 2 } } },
  { name: "$pop on a number", doc: { a: 5 }, ops: { $pop: { a: 1 } } },
  { name: "$addToSet onto a number", doc: { a: 5 }, ops: { $addToSet: { a: 1 } } },
  { name: "$pull on a number", doc: { a: 5 }, ops: { $pull: { a: 1 } } },
  { name: "$pullAll on a number", doc: { a: 5 }, ops: { $pullAll: { a: [1] } } },
  { name: "$set within null", doc: { a: null }, ops: { $set: { "a.b": "foo" } } },

  // Array operators whose path runs *through* a scalar intermediate: there is no
  // array to operate on and Mongo can't traverse the scalar.
  { name: "$push through a scalar", doc: { a: 5 }, ops: { $push: { "a.b": 1 } } },
  { name: "$addToSet through a scalar", doc: { a: 5 }, ops: { $addToSet: { "a.b": 1 } } },
  { name: "$pull through a scalar", doc: { a: 5 }, ops: { $pull: { "a.b": 1 } } },
  { name: "$pullAll through a scalar", doc: { a: 5 }, ops: { $pullAll: { "a.b": [1] } } },
  { name: "$pop through a scalar", doc: { a: 5 }, ops: { $pop: { "a.b": 1 } } },

  // Two operators (or two keys) writing the same path, or a parent/child of it,
  // is a conflict MongoDB rejects rather than applying both.
  { name: "$set and $inc the same path", doc: { a: 1 }, ops: { $set: { a: 2 }, $inc: { a: 1 } } },
  {
    name: "$set a parent and its child",
    doc: { a: { b: 1 } },
    ops: { $set: { a: 5, "a.b": 2 } },
  },
  {
    name: "$rename onto a path another operator writes",
    doc: { a: 1, c: 3 },
    ops: { $rename: { a: "b" }, $set: { b: 9 } },
  },
];

describe("rejection parity (mill vs real mongod)", () => {
  for (const testCase of cases) {
    it(`both reject: ${testCase.name}`, async () => {
      expect(() => millUpdate(structuredClone(testCase.doc), {}, testCase.ops as never)).toThrow();
      await expect(
        runMongoUpdate(structuredClone(testCase.doc), {}, testCase.ops),
      ).rejects.toThrow();
    });
  }
});
