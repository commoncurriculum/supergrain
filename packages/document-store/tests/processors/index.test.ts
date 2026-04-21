import type { DocumentStore } from "../../src";

import { describe, it, expect } from "vitest";

import { defaultProcessor } from "../../src/processors";
import { makePost, makeUser, type TypeToModel, type User } from "../example-app";

// =============================================================================
// Fake store — minimal DocumentStore stand-in that records inserts as a
// plain array. Tests assert on the `inserts` array (what documents got
// cached), not on call counts.
// =============================================================================

function makeFakeStore() {
  const inserts: Array<TypeToModel[keyof TypeToModel]> = [];
  const fake = {
    insertDocument(doc: TypeToModel[keyof TypeToModel]) {
      inserts.push(doc);
    },
  } as unknown as DocumentStore<TypeToModel>;
  return { store: fake, inserts };
}

// =============================================================================
// defaultProcessor
// =============================================================================

describe("defaultProcessor", () => {
  it("inserts a single document returned by the adapter", () => {
    const { store, inserts } = makeFakeStore();
    const user = makeUser("1");

    const returned = defaultProcessor<TypeToModel, User>(user, store);

    expect(inserts).toEqual([user]);
    expect(returned).toEqual([user]);
  });

  it("inserts every document in an array response", () => {
    const { store, inserts } = makeFakeStore();
    const users = [makeUser("1"), makeUser("2"), makeUser("3")];

    const returned = defaultProcessor<TypeToModel, User>(users, store);

    expect(inserts).toEqual(users);
    expect(returned).toEqual(users);
  });

  it("keys each document by its own type and id (no envelope unwrapping)", () => {
    // The default processor does NOT look at { data, included }. If the
    // adapter returns a JSON-API envelope, the default treats the envelope
    // itself as a document — so callers who need envelopes must opt into
    // jsonApiProcessor or a custom one. This test pins that intent by
    // confirming a bare array of mixed types is inserted as-is.
    const { store, inserts } = makeFakeStore();
    const mixed = [makeUser("1"), makePost("10")];

    defaultProcessor<TypeToModel, User>(mixed, store);

    expect(inserts).toEqual(mixed);
  });
});
