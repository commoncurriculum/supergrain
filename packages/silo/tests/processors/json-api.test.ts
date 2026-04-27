import type { Silo } from "../../src";

import { describe, it, expect } from "vitest";

import { jsonApiProcessor } from "../../src/processors/json-api";
import { makePost, makeUser, type TypeToModel } from "../example-app";

// =============================================================================
// Fake store — captures inserts as (type, doc) tuples.
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
  } as unknown as Silo<TypeToModel>;
  return { store: fake, inserts };
}

// =============================================================================
// jsonApiProcessor
//
// Unlike defaultProcessor, this processor reads `type` from each doc in the
// envelope (JSON-API requires resource objects to carry `type`). The `type`
// argument is accepted for API-parity but ignored — the envelope itself is
// authoritative.
// =============================================================================

describe("jsonApiProcessor", () => {
  it("inserts `data` documents keyed by each doc's own envelope type", () => {
    const { store, inserts } = makeFakeStore();
    // A JSON-API-shaped user doc. (For this library User has no type
    // field, but jsonApiProcessor wants one — JSON-API demands it. So we
    // synthesize a JSON-API-shaped envelope here.)
    const userWithType = { ...makeUser("1"), type: "user" as const };

    jsonApiProcessor({ data: [userWithType] }, store, "user");

    expect(inserts).toEqual([{ type: "user", doc: userWithType }]);
  });

  it("sideloads `included` documents by their own envelope type", () => {
    const { store, inserts } = makeFakeStore();
    const userWithType = { ...makeUser("1"), type: "user" as const };
    const postWithType = { ...makePost("10"), type: "post" as const };

    jsonApiProcessor({ data: [userWithType], included: [postWithType] }, store, "user");

    expect(inserts).toEqual([
      { type: "user", doc: userWithType },
      { type: "post", doc: postWithType },
    ]);
  });

  it("handles missing `included` (field is optional)", () => {
    const { store, inserts } = makeFakeStore();
    const userWithType = { ...makeUser("1"), type: "user" as const };

    jsonApiProcessor({ data: [userWithType] }, store, "user");

    expect(inserts).toEqual([{ type: "user", doc: userWithType }]);
  });

  it("handles empty `data` (sideloads still apply)", () => {
    const { store, inserts } = makeFakeStore();
    const postWithType = { ...makePost("10"), type: "post" as const };

    jsonApiProcessor({ data: [], included: [postWithType] }, store, "user");

    expect(inserts).toEqual([{ type: "post", doc: postWithType }]);
  });

  it("handles mixed-type sideloads in `included`", () => {
    const { store, inserts } = makeFakeStore();
    const userWithType = { ...makeUser("1"), type: "user" as const };
    const post10 = { ...makePost("10"), type: "post" as const };
    const post11 = { ...makePost("11"), type: "post" as const };
    const user2 = { ...makeUser("2"), type: "user" as const };

    jsonApiProcessor({ data: [userWithType], included: [post10, post11, user2] }, store, "user");

    expect(inserts).toHaveLength(4);
    const byType = inserts.reduce<Record<string, number>>(
      (acc, i) => ({ ...acc, [i.type]: (acc[i.type] ?? 0) + 1 }),
      {},
    );
    expect(byType).toEqual({ user: 2, post: 2 });
  });

  it("returns void — the library looks up resolved docs from memory afterwards", () => {
    const { store } = makeFakeStore();
    const userWithType = { ...makeUser("1"), type: "user" as const };
    const result = jsonApiProcessor({ data: [userWithType] }, store, "user");
    expect(result).toBeUndefined();
  });

  it("ignores the `type` argument — uses each envelope doc's own type instead", () => {
    // Demonstrates JSON-API's semantics: the envelope is self-describing.
    // Even if the caller's fetch type was "user", an `included` doc of
    // type "post" gets inserted under "post", not "user".
    const { store, inserts } = makeFakeStore();
    const postWithType = { ...makePost("10"), type: "post" as const };

    jsonApiProcessor({ data: [], included: [postWithType] }, store, "user");

    expect(inserts[0]?.type).toBe("post");
  });
});
