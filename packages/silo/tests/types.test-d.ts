// =============================================================================
// types.test-d.ts
// =============================================================================
//
// Type-level tests for the silo public API. `expectTypeOf` calls are runtime
// no-ops but raise TypeScript errors at compile time when an inferred type
// drifts. These tests pin the contract that runtime tests can't see — e.g.
// "findQuery returns QueryHandle<Q[K]['result']>", "insertDocument's `doc`
// argument is narrowed by `type`", "passing the wrong result shape errors".
//
// If a refactor accidentally relaxes a generic to `unknown`, every assertion
// below stops compiling — that's the point.
// =============================================================================
import { describe, expectTypeOf, it } from "vitest";

import {
  createDocumentStore,
  type DocumentHandle,
  type DocumentStore,
  type QueryHandle,
} from "../src";

interface User {
  id: string;
  name: string;
}

interface Post {
  id: string;
  title: string;
  body: string;
}

interface SearchResult {
  total: number;
  ids: Array<string>;
}

type Models = { user: User; post: Post };
type Queries = { search: { params: { q: string }; result: SearchResult } };

describe("createDocumentStore — public type surface", () => {
  it("returns a DocumentStore parameterized by the supplied Models and Queries", () => {
    const store = createDocumentStore<Models, Queries>({
      models: {
        user: { adapter: { find: async (ids) => ids.map((id) => ({ id, name: "x" })) } },
        post: {
          adapter: {
            find: async (ids) => ids.map((id) => ({ id, title: "t", body: "b" })),
          },
        },
      },
      queries: {
        search: {
          adapter: { find: async (paramsList) => paramsList.map(() => ({ total: 0, ids: [] })) },
        },
      },
    });

    expectTypeOf(store).toEqualTypeOf<DocumentStore<Models, Queries>>();
  });

  it("typechecks Models without Queries (Q defaults to empty)", () => {
    const store = createDocumentStore<Models>({
      models: {
        user: { adapter: { find: async (ids) => ids.map((id) => ({ id, name: "x" })) } },
        post: {
          adapter: {
            find: async (ids) => ids.map((id) => ({ id, title: "t", body: "b" })),
          },
        },
      },
    });

    // Without Queries declared, find still narrows by type — proves the
    // default generic doesn't bleed into the document surface.
    expectTypeOf(store.find("user", "1").data).toEqualTypeOf<User | undefined>();
  });
});

describe("DocumentStore.find / findInMemory — `type` narrows doc shape", () => {
  const store = {} as DocumentStore<Models, Queries>;

  it("find('user', id) returns DocumentHandle<User>", () => {
    const h = store.find("user", "1");
    expectTypeOf(h).toEqualTypeOf<DocumentHandle<User>>();
    expectTypeOf(h.data).toEqualTypeOf<User | undefined>();
  });

  it("find('post', id) returns DocumentHandle<Post>", () => {
    const h = store.find("post", "1");
    expectTypeOf(h.data).toEqualTypeOf<Post | undefined>();
  });

  it("findInMemory inferred as M[K] | undefined", () => {
    expectTypeOf(store.findInMemory("user", "1")).toEqualTypeOf<User | undefined>();
    expectTypeOf(store.findInMemory("post", "1")).toEqualTypeOf<Post | undefined>();
  });

  it("rejects an unknown type literal", () => {
    // @ts-expect-error -- "ghost" is not a key of Models
    store.find("ghost", "1");
  });
});

describe("DocumentStore.insertDocument — `doc` narrowed by `type`", () => {
  const store = {} as DocumentStore<Models, Queries>;

  it("accepts a User shape under 'user'", () => {
    store.insertDocument("user", { id: "1", name: "x" });
  });

  it("rejects a Post shape under 'user'", () => {
    // @ts-expect-error -- "title" / "body" don't exist on User
    store.insertDocument("user", { id: "1", title: "t", body: "b" });
  });

  it("rejects an extra field", () => {
    // @ts-expect-error -- excess property
    store.insertDocument("user", { id: "1", name: "x", extra: true });
  });
});

describe("DocumentStore.findQuery — params and result narrowed by `type`", () => {
  const store = {} as DocumentStore<Models, Queries>;

  it("findQuery('search', params) returns QueryHandle<SearchResult>", () => {
    const h = store.findQuery("search", { q: "x" });
    expectTypeOf(h).toEqualTypeOf<QueryHandle<SearchResult>>();
    expectTypeOf(h.data).toEqualTypeOf<SearchResult | undefined>();
  });

  it("findQueryInMemory inferred as result | undefined", () => {
    expectTypeOf(store.findQueryInMemory("search", { q: "x" })).toEqualTypeOf<
      SearchResult | undefined
    >();
  });

  it("rejects mismatched params shape", () => {
    // @ts-expect-error -- params requires `q`
    store.findQuery("search", { wrongField: 1 });
  });

  it("accepts null/undefined as params (lazy gate)", () => {
    store.findQuery("search", null);
    store.findQuery("search", undefined);
  });
});

describe("DocumentStore.insertQueryResult — params + result both narrowed", () => {
  const store = {} as DocumentStore<Models, Queries>;

  it("accepts the matching pair", () => {
    store.insertQueryResult("search", { q: "x" }, { total: 1, ids: ["a"] });
  });

  it("rejects mismatched result shape", () => {
    // @ts-expect-error -- result requires `total` + `ids`
    store.insertQueryResult("search", { q: "x" }, { wrong: 1 });
  });
});
