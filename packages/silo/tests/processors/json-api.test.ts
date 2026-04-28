import type { DocumentStore } from "../../src";

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

// Processors only call `insertDocument` / `insertQueryResult` — the rest of
// the DocumentStore surface isn't reachable from inside a processor. Build a
// Proxy that exposes just those methods and throws if a processor reaches
// for anything else; the throw doubles as a sentinel that the contract has
// shifted under us.
function makeFakeStore(): { store: DocumentStore<TypeToModel>; inserts: Array<Insert> } {
  const inserts: Array<Insert> = [];
  const insertDocument = <K extends keyof TypeToModel & string>(
    type: K,
    doc: TypeToModel[K],
  ): void => {
    inserts.push({ type, doc } as Insert);
  };
  const store = new Proxy({} as DocumentStore<TypeToModel>, {
    get(_target, prop) {
      if (prop === "insertDocument") return insertDocument;
      throw new Error(`Fake store: processor reached for '${String(prop)}', which is not stubbed`);
    },
  });
  return { store, inserts };
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

  it("defaults to empty array when `data` is absent from the envelope", () => {
    // Branch: envelope.data ?? [] — the `??` fallback path
    const { store, inserts } = makeFakeStore();
    const postWithType = { ...makePost("10"), type: "post" as const };

    // No `data` key at all — only `included`
    jsonApiProcessor({ included: [postWithType] } as any, store, "user");

    // Only the included doc was inserted (data defaulted to [])
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.type).toBe("post");
  });

  it("iterates every item in a multi-element `data` array", () => {
    // Pins that the processor doesn't accidentally insert only the head of
    // `data` (an off-by-one would still pass every test that uses a single
    // data item).
    const { store, inserts } = makeFakeStore();
    const u1 = { ...makeUser("1"), type: "user" as const };
    const u2 = { ...makeUser("2"), type: "user" as const };
    const u3 = { ...makeUser("3"), type: "user" as const };

    jsonApiProcessor({ data: [u1, u2, u3] }, store, "user");

    expect(inserts).toEqual([
      { type: "user", doc: u1 },
      { type: "user", doc: u2 },
      { type: "user", doc: u3 },
    ]);
  });

  it("handles an empty envelope ({}) without throwing or inserting anything", () => {
    const { store, inserts } = makeFakeStore();

    expect(() => jsonApiProcessor({} as any, store, "user")).not.toThrow();
    expect(inserts).toEqual([]);
  });
});
