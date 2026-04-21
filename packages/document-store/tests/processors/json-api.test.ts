import type { DocumentStore } from "../../src";

import { describe, it, expect } from "vitest";

import { jsonApiProcessor } from "../../src/processors/json-api";
import { makePost, makeUser, type Post, type TypeToModel, type User } from "../example-app";

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
