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

// One connection + one collection per worker/file (isolated module state) so
// files never share a collection; within a file, each call inserts under its
// own _id (see runMongoUpdate), so cases never clobber one another.
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

// Mongo has no `undefined`; mill treats an `undefined` field as absent. Drop
// `undefined`-valued keys from plain objects before inserting so the seed Mongo
// sees matches the document mill operates on (the driver would otherwise store
// them as null). Non-plain values (Date, Map, Set, RegExp, ...) pass through
// untouched rather than being flattened to `{}`.
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (isPlainObject(value)) {
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

// Deep-scan for an `undefined` value (including array holes). A real Mongo
// document never holds `undefined`, so if mill produces one the oracle must not
// let `toEqual` quietly treat it as an absent key.
function containsUndefined(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item, index) => !(index in value) || containsUndefined(item));
  }
  if (isPlainObject(value)) {
    return Object.values(value).some((item) => item === undefined || containsUndefined(item));
  }
  return false;
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
  // A unique _id per insert (rather than deleteMany before each) means parallel
  // or interleaved calls never clobber one another's document.
  const { insertedId } = await collection.insertOne(seed as never);
  // Scope the update to our document by _id while still applying `query` for
  // positional ($) resolution, and require it to actually match — otherwise a
  // query that doesn't select the seed would make Mongo silently no-op and we'd
  // be validating mill against "Mongo did nothing".
  const { matchedCount } = await collection.updateOne(
    { _id: insertedId, ...query } as never,
    ops as never,
    (options ?? {}) as never,
  );
  if (matchedCount !== 1) {
    throw new Error(
      `oracle query ${JSON.stringify(query)} did not select the seeded document (matchedCount=${matchedCount}).`,
    );
  }
  const result = (await collection.findOne({ _id: insertedId })) as Record<string, unknown>;
  // _id is a Mongo-ism mill doesn't model — compare on document data only.
  delete result._id;
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

    // A Mongo document can't hold `undefined`; if mill produced one, that's a
    // present-vs-absent divergence toEqual would otherwise hide.
    if (containsUndefined(call.after)) {
      throw new Error(
        `${context}\n  mill produced an \`undefined\` value (or array hole), which MongoDB cannot represent.`,
      );
    }

    let mongoDoc: Record<string, unknown>;
    try {
      mongoDoc = await runMongoUpdate(call.before, call.query, call.ops, call.options);
    } catch (error) {
      throw new Error(
        `${context}\n  mill applied this update, but real MongoDB rejected it: ${String(error)}`,
      );
    }
    const millDoc = { ...call.after };
    delete millDoc._id; // ignore _id (Mongo-only) on mill's side too
    expect(millDoc, context).toEqual(mongoDoc);
  }
}

export async function closeMongo(): Promise<void> {
  if (connection) {
    const { client } = await connection;
    await client.close();
    connection = undefined;
  }
}
