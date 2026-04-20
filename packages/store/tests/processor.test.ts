import type { Store } from "../src";

import { describe, it, expect } from "vitest";

import { defaultProcessor, jsonApiProcessor } from "../src";
import { makePost, makeUser, type Post, type TypeToModel, type User } from "./example-app";

// =============================================================================
// Fake store — minimal Store stand-in that records inserts as a plain array.
// Tests assert on the `inserts` array (what documents got cached), not on
// call counts.
// =============================================================================

function makeFakeStore() {
  const inserts: Array<TypeToModel[keyof TypeToModel]> = [];
  const fake = {
    insertDocument(doc: TypeToModel[keyof TypeToModel]) {
      inserts.push(doc);
    },
  } as unknown as Store<TypeToModel>;
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

// =============================================================================
// jsonApiProcessor
// =============================================================================

describe("jsonApiProcessor", () => {
  it("inserts documents from `data` and returns them", () => {
    const { store, inserts } = makeFakeStore();
    const user = makeUser("1");

    const returned = jsonApiProcessor<TypeToModel, User>({ data: [user] }, store);

    expect(inserts).toEqual([user]);
    expect(returned).toEqual([user]);
  });

  it("sideloads documents from `included` into the store", () => {
    const { store, inserts } = makeFakeStore();
    const user = makeUser("1");
    const sideloadedPost = makePost("10");

    jsonApiProcessor<TypeToModel, User>({ data: [user], included: [sideloadedPost] }, store);

    expect(inserts).toEqual([user, sideloadedPost]);
  });

  it("returns only `data`, never `included`", () => {
    const { store } = makeFakeStore();
    const user = makeUser("1");
    const sideloaded = makePost("10");

    const returned = jsonApiProcessor<TypeToModel, User>(
      { data: [user], included: [sideloaded] },
      store,
    );

    expect(returned).toEqual([user]);
    expect(returned).not.toContain(sideloaded as unknown as User);
  });

  it("handles missing `included` (field is optional)", () => {
    const { store, inserts } = makeFakeStore();
    const user = makeUser("1");

    const returned = jsonApiProcessor<TypeToModel, User>({ data: [user] }, store);

    expect(inserts).toEqual([user]);
    expect(returned).toEqual([user]);
  });

  it("handles empty `data`", () => {
    const { store, inserts } = makeFakeStore();

    const returned = jsonApiProcessor<TypeToModel, User>(
      { data: [], included: [makePost("10") as Post] },
      store,
    );

    expect(returned).toEqual([]);
    // Included is still sideloaded even when data is empty.
    expect(inserts.length).toBe(1);
  });

  it("handles mixed-type sideloads in `included`", () => {
    const { store, inserts } = makeFakeStore();
    const user = makeUser("1");

    jsonApiProcessor<TypeToModel, User>(
      {
        data: [user],
        included: [makePost("10"), makePost("11"), makeUser("2")],
      },
      store,
    );

    expect(inserts.length).toBe(4);
  });
});
