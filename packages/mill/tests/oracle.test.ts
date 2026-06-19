import { MongoClient, type Collection } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { update as millUpdate } from "../src";

// ─── Mongo-semantics oracle (mill vs REAL mongod) ────────────────────────────
//
// mill's MongoDB compatibility must not rest on memory — nor on a third-party
// reimplementation (mingo was checked and found to diverge from real MongoDB on
// $min-on-missing, $rename, and type-error validation). This oracle boots an
// actual `mongod` (mongodb-memory-server) and, for each case, applies the SAME
// update via real MongoDB and via mill to identical documents, asserting they
// agree: same resulting document, or both reject. A divergence is a mill bug.

interface OracleCase {
  name: string;
  doc: Record<string, unknown>;
  ops: Record<string, unknown>;
}

const cases: Array<OracleCase> = [
  // $set
  { name: "$set existing scalar", doc: { a: 1, b: 2 }, ops: { $set: { a: 10 } } },
  { name: "$set new field", doc: { a: 1 }, ops: { $set: { b: 2 } } },
  { name: "$set nested existing", doc: { a: { b: 1 } }, ops: { $set: { "a.b": 9 } } },
  { name: "$set creates nested branch", doc: { keep: 1 }, ops: { $set: { "a.b.c": 9 } } },
  { name: "$set array index", doc: { a: [1, 2, 3] }, ops: { $set: { "a.1": 9 } } },
  { name: "$set same value", doc: { a: 1 }, ops: { $set: { a: 1 } } },

  // $unset
  { name: "$unset existing", doc: { a: 1, b: 2 }, ops: { $unset: { a: "" } } },
  { name: "$unset nested", doc: { a: { b: 1, c: 2 } }, ops: { $unset: { "a.b": "" } } },
  { name: "$unset missing", doc: { a: 1 }, ops: { $unset: { z: "" } } },

  // $inc / $mul
  { name: "$inc existing", doc: { n: 5 }, ops: { $inc: { n: 3 } } },
  { name: "$inc negative", doc: { n: 5 }, ops: { $inc: { n: -2 } } },
  { name: "$inc missing", doc: { keep: 1 }, ops: { $inc: { n: 3 } } },
  { name: "$inc nested missing", doc: { a: {} }, ops: { $inc: { "a.n": 4 } } },
  { name: "$mul existing", doc: { n: 5 }, ops: { $mul: { n: 3 } } },
  { name: "$mul missing", doc: { keep: 1 }, ops: { $mul: { n: 5 } } },

  // $min / $max
  { name: "$min lowers", doc: { n: 5 }, ops: { $min: { n: 3 } } },
  { name: "$min keeps", doc: { n: 5 }, ops: { $min: { n: 9 } } },
  { name: "$min missing", doc: { keep: 1 }, ops: { $min: { n: 3 } } },
  { name: "$max raises", doc: { n: 5 }, ops: { $max: { n: 9 } } },
  { name: "$max keeps", doc: { n: 5 }, ops: { $max: { n: 3 } } },
  { name: "$max missing", doc: { keep: 1 }, ops: { $max: { n: 3 } } },

  // $rename
  { name: "$rename existing", doc: { a: 1, c: 3 }, ops: { $rename: { a: "b" } } },
  { name: "$rename missing source", doc: { a: 1 }, ops: { $rename: { z: "b" } } },
  { name: "$rename nested", doc: { a: { b: 1 } }, ops: { $rename: { "a.b": "a.c" } } },

  // $push
  { name: "$push existing", doc: { a: [1, 2] }, ops: { $push: { a: 3 } } },
  { name: "$push missing", doc: { keep: 1 }, ops: { $push: { a: 1 } } },
  { name: "$push nested missing", doc: { a: {} }, ops: { $push: { "a.b": 1 } } },
  { name: "$push $each", doc: { a: [1] }, ops: { $push: { a: { $each: [2, 3] } } } },
  { name: "$push $each empty", doc: { a: [1] }, ops: { $push: { a: { $each: [] } } } },
  {
    name: "$push $position",
    doc: { a: [1, 4] },
    ops: { $push: { a: { $each: [2, 3], $position: 1 } } },
  },
  {
    name: "$push $slice",
    doc: { a: [1, 2, 3] },
    ops: { $push: { a: { $each: [4, 5], $slice: 3 } } },
  },
  {
    name: "$push $slice negative",
    doc: { a: [1, 2, 3] },
    ops: { $push: { a: { $each: [4, 5], $slice: -2 } } },
  },
  { name: "$push $sort asc", doc: { a: [3, 1] }, ops: { $push: { a: { $each: [2], $sort: 1 } } } },

  // $pop
  { name: "$pop last", doc: { a: [1, 2, 3] }, ops: { $pop: { a: 1 } } },
  { name: "$pop first", doc: { a: [1, 2, 3] }, ops: { $pop: { a: -1 } } },
  { name: "$pop missing", doc: { keep: 1 }, ops: { $pop: { a: 1 } } },
  { name: "$pop empty", doc: { a: [] }, ops: { $pop: { a: 1 } } },

  // $pull
  { name: "$pull value", doc: { a: [1, 2, 3, 2] }, ops: { $pull: { a: 2 } } },
  { name: "$pull no match", doc: { a: [1, 2, 3] }, ops: { $pull: { a: 9 } } },
  { name: "$pull missing", doc: { keep: 1 }, ops: { $pull: { a: 2 } } },
  { name: "$pull gte", doc: { a: [1, 2, 3, 4, 5] }, ops: { $pull: { a: { $gte: 3 } } } },
  { name: "$pull in", doc: { a: [1, 2, 3, 4] }, ops: { $pull: { a: { $in: [2, 4] } } } },
  {
    name: "$pull object field",
    doc: { a: [{ id: 1 }, { id: 2 }, { id: 1 }] },
    ops: { $pull: { a: { id: 1 } } },
  },

  // $pullAll
  { name: "$pullAll", doc: { a: [1, 2, 3, 2, 1] }, ops: { $pullAll: { a: [1, 2] } } },
  { name: "$pullAll no match", doc: { a: [1, 2, 3] }, ops: { $pullAll: { a: [9] } } },
  { name: "$pullAll missing", doc: { keep: 1 }, ops: { $pullAll: { a: [1] } } },

  // $addToSet
  { name: "$addToSet new", doc: { a: [1, 2] }, ops: { $addToSet: { a: 3 } } },
  { name: "$addToSet dup", doc: { a: [1, 2] }, ops: { $addToSet: { a: 2 } } },
  { name: "$addToSet missing", doc: { keep: 1 }, ops: { $addToSet: { a: 1 } } },
  { name: "$addToSet $each", doc: { a: [1] }, ops: { $addToSet: { a: { $each: [1, 2, 3] } } } },

  // multi-operator
  {
    name: "multi $set + $inc + $push",
    doc: { a: 1, n: 0, arr: [1] },
    ops: { $set: { a: 2 }, $inc: { n: 5 }, $push: { arr: 2 } },
  },

  // type errors — both should reject
  { name: "$push onto a number", doc: { a: 5 }, ops: { $push: { a: 1 } } },
  { name: "$inc on a string", doc: { a: "x" }, ops: { $inc: { a: 1 } } },
  { name: "$pop on a number", doc: { a: 5 }, ops: { $pop: { a: 1 } } },
  { name: "$addToSet onto a number", doc: { a: 5 }, ops: { $addToSet: { a: 1 } } },
];

function outcome(apply: () => void): { threw: boolean } {
  try {
    apply();
    return { threw: false };
  } catch {
    return { threw: true };
  }
}

let server: MongoMemoryServer;
let client: MongoClient;
let collection: Collection;

describe("Mongo-semantics oracle (mill vs real mongod)", () => {
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    collection = client.db("oracle").collection("docs");
  }, 240_000);

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  for (const testCase of cases) {
    it(testCase.name, async () => {
      // Real MongoDB.
      await collection.deleteMany({});
      await collection.insertOne({ _id: 1 as any, ...structuredClone(testCase.doc) });
      let mongoThrew = false;
      try {
        await collection.updateOne({ _id: 1 as any }, testCase.ops);
      } catch {
        mongoThrew = true;
      }
      const mongoDoc = (await collection.findOne({ _id: 1 as any })) as Record<string, unknown>;
      delete mongoDoc._id;

      // mill.
      const millDoc = structuredClone(testCase.doc);
      const millOutcome = outcome(() => millUpdate(millDoc, {}, testCase.ops as never));

      expect(millOutcome.threw).toBe(mongoThrew);
      if (!mongoThrew) {
        expect(millDoc).toEqual(mongoDoc);
      }
    });
  }
});
