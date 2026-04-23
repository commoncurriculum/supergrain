import type { DocumentStore } from "../../src";

import { describe, it, expect } from "vitest";

import { defaultProcessor, defaultQueryProcessor } from "../../src/processors";
import {
  makeDashboard,
  makePost,
  makeUser,
  type DashboardParams,
  type TypeToModel,
  type TypeToQuery,
} from "../example-app";

// =============================================================================
// Fake store — captures inserts as (type, doc) tuples. Tests assert on the
// captured tuples rather than on the real store, since processor behavior
// is independent of cache implementation.
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

interface QueryInsert {
  type: string;
  params: unknown;
  result: unknown;
}

function makeFakeQueryStore() {
  const inserts: Array<QueryInsert> = [];
  const fake = {
    insertQueryResult(type: string, params: unknown, result: unknown) {
      inserts.push({ type, params, result });
    },
  } as unknown as DocumentStore<TypeToModel, TypeToQuery>;
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

// =============================================================================
// defaultQueryProcessor
//
// Used when `QueryConfig.processor` is omitted. The adapter is expected to
// return an array of results aligned 1:1 with `paramsList`; the processor
// pairs them by position and inserts under the query's type slot.
// =============================================================================

describe("defaultQueryProcessor", () => {
  it("pairs results with paramsList by position", () => {
    const { store, inserts } = makeFakeQueryStore();
    const paramsList: Array<DashboardParams> = [
      { workspaceId: 7, filters: { active: true } },
      { workspaceId: 8, filters: { active: false } },
    ];
    const results = [
      makeDashboard({ totalActiveUsers: 70 }),
      makeDashboard({ totalActiveUsers: 80 }),
    ];

    defaultQueryProcessor(results, store, "dashboard", paramsList);

    expect(inserts).toEqual([
      { type: "dashboard", params: paramsList[0], result: results[0] },
      { type: "dashboard", params: paramsList[1], result: results[1] },
    ]);
  });

  it("hands each params object through by reference — no stringification by the processor", () => {
    // The library stable-stringifies for cache lookup internally; the
    // processor itself never stringifies. It must pass the original
    // params object reference through to insertQueryResult.
    const { store, inserts } = makeFakeQueryStore();
    const params: DashboardParams = { workspaceId: 7, filters: { active: true } };
    const result = makeDashboard({ totalActiveUsers: 70 });

    defaultQueryProcessor([result], store, "dashboard", [params]);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toBe(params);
    expect(inserts[0].result).toBe(result);
  });

  it("uses the caller's `type` argument for every insert", () => {
    const { store, inserts } = makeFakeQueryStore();
    const paramsList: Array<DashboardParams> = [
      { workspaceId: 7, filters: { active: true } },
      { workspaceId: 8, filters: { active: true } },
    ];
    const results = [makeDashboard(), makeDashboard()];

    defaultQueryProcessor(results, store, "dashboard", paramsList);

    expect(inserts.every((i) => i.type === "dashboard")).toBe(true);
  });

  it("returns void — the library looks up resolved query results from memory afterwards", () => {
    const { store } = makeFakeQueryStore();
    const result = defaultQueryProcessor([makeDashboard()], store, "dashboard", [
      { workspaceId: 7, filters: { active: true } },
    ]);
    expect(result).toBeUndefined();
  });
});
