import { MongoClient, type Collection } from "mongodb";
import { expect, inject } from "vitest";

// ─── Real-mongod oracle ──────────────────────────────────────────────────────
//
// Every mutating test records the `(before, query, ops, options) -> after` it
// asked mill to perform. After each test, `validateRecordedAgainstMongo()`
// replays each recorded update against a real `mongod` and asserts mill landed
// on the identical document. So the per-operator tests keep their readable,
// hand-written forward assertions, but the question "is that actually what
// MongoDB does?" is answered by MongoDB on every test — not by pre-training.

export interface RecordedUpdate {
  testName: string;
  before: Record<string, unknown>;
  query: Record<string, unknown>;
  ops: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
  after: Record<string, unknown>;
}

const recorded: Array<RecordedUpdate> = [];

// One connection + one collection per worker/file (isolated module state), so
// concurrent test files never clobber each other's single document.
const collectionName = `docs_${crypto.randomUUID().replace(/-/gu, "")}`;
let connection: Promise<{ client: MongoClient; collection: Collection }> | undefined;

function connect(): Promise<{ client: MongoClient; collection: Collection }> {
  if (!connection) {
    const uri = inject("millMongoUri");
    connection = (async () => {
      const client = new MongoClient(uri);
      await client.connect();
      return { client, collection: client.db("oracle").collection(collectionName) };
    })();
  }
  return connection;
}

// Mongo has no `undefined`; mill treats an `undefined` field as absent. Drop
// `undefined`-valued object keys before inserting so the seed Mongo sees matches
// the document mill operates on (the driver would otherwise store them as null).
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) {
        out[key] = stripUndefined(item);
      }
    }
    return out;
  }
  return value;
}

// Apply `ops` to a fresh copy of `doc` in real MongoDB and return the resulting
// document. Throws whatever MongoDB throws when it rejects the update.
export async function runMongoUpdate(
  doc: Record<string, unknown>,
  query: Record<string, unknown>,
  ops: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { collection } = await connect();
  const seed = stripUndefined(structuredClone(doc)) as Record<string, unknown>;
  await collection.deleteMany({});
  const { insertedId } = await collection.insertOne(seed as never);
  await collection.updateOne(query, ops, (options ?? {}) as never);
  // Retrieve by the inserted id, never by `query` — the update may have changed
  // the very field the query matched on, leaving the doc unmatchable.
  const result = (await collection.findOne({ _id: insertedId })) as Record<string, unknown>;
  // Strip the _id Mongo assigns when the document didn't carry one itself, so
  // it doesn't show up as a phantom difference against mill's plain document.
  if (!("_id" in doc)) {
    delete result._id;
  }
  return result;
}

export function recordUpdate(call: Omit<RecordedUpdate, "testName">): void {
  recorded.push({ testName: expect.getState().currentTestName ?? "<unknown>", ...call });
}

// Replay every update recorded during the current test against real mongod and
// assert mill produced the identical document; then clear the buffer.
export async function validateRecordedAgainstMongo(): Promise<void> {
  const calls = recorded.splice(0, recorded.length);
  for (const call of calls) {
    const context =
      `mill diverged from real MongoDB — ${call.testName}\n` +
      `  doc:     ${JSON.stringify(call.before)}\n` +
      `  query:   ${JSON.stringify(call.query)}\n` +
      `  ops:     ${JSON.stringify(call.ops)}` +
      (call.options ? `\n  options: ${JSON.stringify(call.options)}` : "");

    let mongoDoc: Record<string, unknown>;
    try {
      mongoDoc = await runMongoUpdate(call.before, call.query, call.ops, call.options);
    } catch (error) {
      throw new Error(
        `${context}\n  mill applied this update, but real MongoDB rejected it: ${String(error)}`,
      );
    }
    expect(call.after, context).toEqual(mongoDoc);
  }
}

export async function closeMongo(): Promise<void> {
  if (connection) {
    const { client } = await connection;
    await client.close();
    connection = undefined;
  }
}
