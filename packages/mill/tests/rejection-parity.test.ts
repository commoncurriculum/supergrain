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
  { name: "$inc on a string", doc: { a: "x" }, ops: { $inc: { a: 1 } } },
  { name: "$mul on a string", doc: { a: "x" }, ops: { $mul: { a: 2 } } },
  { name: "$pop on a number", doc: { a: 5 }, ops: { $pop: { a: 1 } } },
  { name: "$addToSet onto a number", doc: { a: 5 }, ops: { $addToSet: { a: 1 } } },
  { name: "$pull on a number", doc: { a: 5 }, ops: { $pull: { a: 1 } } },
  { name: "$pullAll on a number", doc: { a: 5 }, ops: { $pullAll: { a: [1] } } },
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
