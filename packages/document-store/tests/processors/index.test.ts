import type { DocumentStore } from "../../src";

import { describe, it, expect } from "vitest";

import { defaultProcessor } from "../../src/processors";
import { makePost, makeUser, type TypeToModel } from "../example-app";

// =============================================================================
// Fake store — captures inserts as (type, doc) tuples. Tests assert on the
// captured tuples rather than on the real MemoryEngine, since processor
// behavior is independent of cache implementation.
// =============================================================================

interface Insert<K extends keyof TypeToModel = keyof TypeToModel> {
  type: K;
  doc: TypeToModel[K];
}

function makeFakeStore() {
  const inserts: Array<Insert> = [];
  const fake = {
    insertDocument<K extends keyof TypeToModel & string>(type: K, doc: TypeToModel[K]) {
      inserts.push({ type, doc } as Insert);
    },
  } as unknown as DocumentStore<TypeToModel>;
  return { store: fake, inserts };
}

// =============================================================================
// defaultProcessor
// =============================================================================

describe("defaultProcessor", () => {
  it("inserts a single document under the `type` argument", () => {
    const { store, inserts } = makeFakeStore();
    const user = makeUser("1");

    defaultProcessor(user, store, "user");

    expect(inserts).toEqual([{ type: "user", doc: user }]);
  });

  it("inserts every document in an array response under the same `type`", () => {
    const { store, inserts } = makeFakeStore();
    const users = [makeUser("1"), makeUser("2"), makeUser("3")];

    defaultProcessor(users, store, "user");

    expect(inserts).toEqual([
      { type: "user", doc: users[0] },
      { type: "user", doc: users[1] },
      { type: "user", doc: users[2] },
    ]);
  });

  it("does not read a `type` field from the doc — uses the `type` argument", () => {
    // User has no `type` field. defaultProcessor keys inserts by the
    // caller's `type` argument, so APIs that omit type from the wire format
    // (like our `user` endpoint) work without modification.
    const { store, inserts } = makeFakeStore();
    const user = makeUser("1");
    expect("type" in user).toBe(false);

    defaultProcessor(user, store, "user");

    expect(inserts).toEqual([{ type: "user", doc: user }]);
  });

  it("returns void — the library looks up resolved docs from memory afterwards", () => {
    const { store } = makeFakeStore();
    const result = defaultProcessor(makeUser("1"), store, "user");
    expect(result).toBeUndefined();
  });

  it("is invoked once per model; it does not recurse across types itself", () => {
    // If the caller's adapter returns an array of mixed-type docs, that's
    // on them — defaultProcessor inserts every item under the single `type`
    // argument. This test pins that intent: it's the consumer's job to
    // pair adapter output shape with a processor that knows how to split
    // types (e.g. jsonApiProcessor) when mixing is needed.
    const { store, inserts } = makeFakeStore();
    const mixed = [makeUser("1"), makePost("10")];

    // Everything goes in under "user" because that's the arg — the second
    // item is structurally compatible (it has an id) and gets inserted.
    defaultProcessor(mixed, store, "user");

    expect(inserts).toHaveLength(2);
    expect(inserts[0].type).toBe("user");
    expect(inserts[1].type).toBe("user");
  });
});
