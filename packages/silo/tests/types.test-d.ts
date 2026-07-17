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
  type DocumentsTogetherHandle,
  type DocumentStore,
  type DocumentStoreConfig,
  type HandleStatus,
  type QueryHandle,
  type SiloError,
} from "../src";
import { effectFind } from "./setup/effect-find";

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

// Shared `models` config for tests that only vary another field (e.g. `hooks`).
const userPostModels = {
  user: {
    adapter: {
      find: effectFind("test", (ids: Array<string>) =>
        Promise.resolve(ids.map((id) => ({ id, name: "x" }))),
      ),
    },
  },
  post: {
    adapter: {
      find: effectFind("test", (ids: Array<string>) =>
        Promise.resolve(ids.map((id) => ({ id, title: "t", body: "b" }))),
      ),
    },
  },
} satisfies DocumentStoreConfig<Models>["models"];

describe("createDocumentStore — public type surface", () => {
  it("returns a DocumentStore parameterized by the supplied Models and Queries", () => {
    const store = createDocumentStore<Models, Queries>({
      models: {
        user: {
          adapter: {
            find: effectFind("test", (ids: Array<string>) =>
              Promise.resolve(ids.map((id) => ({ id, name: "x" }))),
            ),
          },
        },
        post: {
          adapter: {
            find: effectFind("test", (ids: Array<string>) =>
              Promise.resolve(ids.map((id) => ({ id, title: "t", body: "b" }))),
            ),
          },
        },
      },
      queries: {
        search: {
          adapter: {
            find: effectFind("test", (paramsList: Array<{ q: string }>) =>
              Promise.resolve(paramsList.map(() => ({ total: 0, ids: [] }))),
            ),
          },
        },
      },
    });

    expectTypeOf(store).toEqualTypeOf<DocumentStore<Models, Queries>>();
  });

  it("typechecks Models without Queries (Q defaults to empty)", () => {
    const store = createDocumentStore<Models>({
      models: {
        user: {
          adapter: {
            find: effectFind("test", (ids: Array<string>) =>
              Promise.resolve(ids.map((id) => ({ id, name: "x" }))),
            ),
          },
        },
        post: {
          adapter: {
            find: effectFind("test", (ids: Array<string>) =>
              Promise.resolve(ids.map((id) => ({ id, title: "t", body: "b" }))),
            ),
          },
        },
      },
    });

    // Without Queries declared, find still narrows by type — proves the
    // default generic doesn't bleed into the document surface.
    expectTypeOf(store.find("user", "1").value).toEqualTypeOf<User | undefined>();
  });
});

describe("DocumentStore.find / findInMemory — `type` narrows doc shape", () => {
  const store = {} as DocumentStore<Models, Queries>;

  it("find('user', id) returns DocumentHandle<User>", () => {
    const h = store.find("user", "1");
    expectTypeOf(h).toEqualTypeOf<DocumentHandle<User>>();
    expectTypeOf(h.value).toEqualTypeOf<User | undefined>();
  });

  it("find('post', id) returns DocumentHandle<Post>", () => {
    const h = store.find("post", "1");
    expectTypeOf(h.value).toEqualTypeOf<Post | undefined>();
  });

  it("findInMemory inferred as M[K] | undefined", () => {
    expectTypeOf(store.findInMemory("user", "1")).toEqualTypeOf<User | undefined>();
    expectTypeOf(store.findInMemory("post", "1")).toEqualTypeOf<Post | undefined>();
  });

  it("rejects an unknown type literal", () => {
    // @ts-expect-error -- "ghost" is not a key of Models
    store.find("ghost", "1");
  });

  it("accepts null and undefined as the id argument (lazy gate)", () => {
    // The runtime returns an IDLE handle for null/undefined ids; the type
    // signature must permit them so consumer code like
    // `useDocument("user", maybeId)` typechecks.
    store.find("user", null);
    store.find("user", undefined);
  });

  it("DocumentHandle exposes correctly-typed observable fields", () => {
    // The flat orthogonal fields below are the binding surface for UI
    // components; pin their types so a refactor that relaxes any of them to
    // `unknown` (or drops one) breaks compilation here.
    const h = store.find("user", "1");
    expectTypeOf(h.value).toEqualTypeOf<User | undefined>();
    expectTypeOf(h.error).toEqualTypeOf<SiloError | undefined>();
    expectTypeOf(h.isFetching).toEqualTypeOf<boolean>();
    expectTypeOf(h.fetchedAt).toEqualTypeOf<Date | undefined>();
    expectTypeOf(h.status).toEqualTypeOf<HandleStatus>();
    expectTypeOf(h.promise).toEqualTypeOf<Promise<User> | undefined>();
  });
});

describe("DocumentStore.findDocumentsIndividually / findDocumentsTogether — `type` narrows doc shape", () => {
  const store = {} as DocumentStore<Models, Queries>;

  it("findDocumentsIndividually returns an array of DocumentHandle<T>", () => {
    expectTypeOf(store.findDocumentsIndividually("user", ["1"])).toEqualTypeOf<
      Array<DocumentHandle<User>>
    >();
    expectTypeOf(store.findDocumentsIndividually("post", ["1"])).toEqualTypeOf<
      Array<DocumentHandle<Post>>
    >();
  });

  it("findDocumentsTogether returns DocumentsTogetherHandle<T>", () => {
    const docs = store.findDocumentsTogether("user", ["1"]);
    expectTypeOf(docs).toEqualTypeOf<DocumentsTogetherHandle<User>>();
    expectTypeOf(docs.value).toEqualTypeOf<Array<User> | undefined>();
    expectTypeOf(docs.promise).toEqualTypeOf<Promise<Array<User>> | undefined>();
  });

  it("narrowing on `status` refines `value` (discriminated union)", () => {
    const docs = store.findDocumentsTogether("user", ["1"]);
    if (docs.status === "success") {
      expectTypeOf(docs.value).toEqualTypeOf<Array<User>>();
      expectTypeOf(docs.error).toEqualTypeOf<undefined>();
    }
    if (docs.status === "error") {
      expectTypeOf(docs.value).toEqualTypeOf<undefined>();
      expectTypeOf(docs.error).toEqualTypeOf<SiloError>();
    }
    if (docs.status === "pending") {
      expectTypeOf(docs.value).toEqualTypeOf<undefined>();
    }
  });

  it("both accept null / undefined ids (lazy gate)", () => {
    store.findDocumentsIndividually("user", null);
    store.findDocumentsTogether("user", undefined);
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

describe("DocumentStoreConfig.hooks.prepareInsert — `doc`/return tied to the type key", () => {
  it("types `doc` as M[K] and accepts returning the doc — or nothing (pass-through)", () => {
    createDocumentStore<Models>({
      hooks: {
        prepareInsert(_type, doc) {
          // Generic over the type key K — `type: K`, `doc: M[K]`. `doc` carries
          // the model's own fields (here, the shared `id`), and returning it is
          // accepted because it's the M[K] the hook received.
          expectTypeOf(doc.id).toEqualTypeOf<string>();
          return doc;
        },
        afterInsert(_type, doc) {
          expectTypeOf(doc.id).toEqualTypeOf<string>();
        },
      },
      models: userPostModels,
    });
  });

  it("accepts a hook that mutates in place and returns nothing (no `| void` footgun)", () => {
    createDocumentStore<Models>({
      hooks: {
        // No `return` is valid — the `void` arm is the pass-through path, not a
        // silent veto, so forgetting `return doc` is harmless rather than data loss.
        prepareInsert(_type, doc) {
          void doc.id;
        },
      },
      models: userPostModels,
    });
  });

  it("rejects returning a fixed-model doc that ignores the type key", () => {
    createDocumentStore<Models>({
      hooks: {
        // @ts-expect-error -- a fixed User can't satisfy M[K] for an arbitrary K (the insert could be a Post)
        prepareInsert: () => ({ id: "1", name: "x" }),
      },
      models: userPostModels,
    });
  });

  it("rejects a non-generic hook that pre-narrows its parameters to one model", () => {
    createDocumentStore<Models>({
      hooks: {
        // @ts-expect-error -- a hook fixed to ("user", User) can't accept an arbitrary (K, M[K])
        prepareInsert: (_type: "user", doc: User) => doc,
      },
      models: userPostModels,
    });
  });
});

describe("DocumentStore.findQuery — params and result narrowed by `type`", () => {
  const store = {} as DocumentStore<Models, Queries>;

  it("findQuery('search', params) returns QueryHandle<SearchResult>", () => {
    const h = store.findQuery("search", { q: "x" });
    expectTypeOf(h).toEqualTypeOf<QueryHandle<SearchResult>>();
    expectTypeOf(h.value).toEqualTypeOf<SearchResult | undefined>();
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

  it("rejects mismatched params shape", () => {
    // @ts-expect-error -- params requires `q` (not `notQ`)
    store.insertQueryResult("search", { notQ: "x" }, { total: 1, ids: ["a"] });
  });
});

describe("QueryHandle exposes correctly-typed observable fields", () => {
  const store = {} as DocumentStore<Models, Queries>;

  it("value / error / promise all carry the result generic", () => {
    const h = store.findQuery("search", { q: "x" });
    expectTypeOf(h.value).toEqualTypeOf<SearchResult | undefined>();
    expectTypeOf(h.error).toEqualTypeOf<SiloError | undefined>();
    expectTypeOf(h.isFetching).toEqualTypeOf<boolean>();
    expectTypeOf(h.fetchedAt).toEqualTypeOf<Date | undefined>();
    expectTypeOf(h.status).toEqualTypeOf<HandleStatus>();
    expectTypeOf(h.promise).toEqualTypeOf<Promise<SearchResult> | undefined>();
  });
});
