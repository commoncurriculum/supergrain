import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createDocumentStore, type DocumentStore } from "../src";

type TestModels = {
  user: { id: string; name: string };
};

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

type TestQueries = {
  search: {
    params: JsonValue;
    result: { token: number };
  };
};

type Operation =
  | { type: "insertDocument"; id: string; name: string }
  | { type: "insertQuery"; params: JsonValue; token: number }
  | { type: "clearMemory" };

const jsonValueArbitrary = fc.jsonValue() as fc.Arbitrary<JsonValue>;
const queryTokenArbitrary = fc.integer({ min: -100, max: 100 });
const documentIdArbitrary = fc.string({ minLength: 1, maxLength: 4 });
const documentNameArbitrary = fc.string({ maxLength: 8 });

const operationArbitrary: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({
    type: fc.constant<"insertDocument">("insertDocument"),
    id: documentIdArbitrary,
    name: documentNameArbitrary,
  }),
  fc.record({
    type: fc.constant<"insertQuery">("insertQuery"),
    params: jsonValueArbitrary,
    token: queryTokenArbitrary,
  }),
  fc.constant<Operation>({ type: "clearMemory" }),
);

function sortKeysDeep(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, nested]) => [key, sortKeysDeep(nested)]));
  }
  return value;
}

function reorderKeysDeep(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(reorderKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).reverse();
    return Object.fromEntries(entries.map(([key, nested]) => [key, reorderKeysDeep(nested)]));
  }
  return value;
}

function canonicalParamsKey(value: JsonValue): string {
  return JSON.stringify(sortKeysDeep(value));
}

function createTestStore(): DocumentStore<TestModels, TestQueries> {
  return createDocumentStore<TestModels, TestQueries>({
    models: {
      user: { adapter: { find: async () => [] } },
    },
    queries: {
      search: {
        adapter: {
          async find(paramsList) {
            return paramsList.map((_, index) => ({ token: index }));
          },
        },
      },
    },
  });
}

describe("silo property-based tests", () => {
  it("treats recursively reordered query params as the same cache slot", () => {
    fc.assert(
      fc.property(jsonValueArbitrary, queryTokenArbitrary, (params, token) => {
        const store = createTestStore();
        const reordered = reorderKeysDeep(params);
        const result = { token };

        store.insertQueryResult("search", params, result);

        expect(store.findQueryInMemory("search", reordered)).toBe(result);
        expect(store.findQuery("search", params)).toBe(store.findQuery("search", reordered));
      }),
      { numRuns: 100 },
    );
  });

  it("keeps document and query memory aligned with a plain model across mixed operations", () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 40 }), (operations) => {
        const store = createTestStore();
        const expectedDocuments = new Map<string, { id: string; name: string }>();
        const expectedQueries = new Map<string, { token: number }>();
        const seenDocumentIds = new Set<string>();
        const seenParams = new Map<string, JsonValue>();

        for (const operation of operations) {
          switch (operation.type) {
            case "insertDocument": {
              const doc = { id: operation.id, name: operation.name };
              seenDocumentIds.add(operation.id);
              expectedDocuments.set(operation.id, doc);
              store.insertDocument("user", doc);
              break;
            }
            case "insertQuery": {
              const result = { token: operation.token };
              const paramsKey = canonicalParamsKey(operation.params);
              seenParams.set(paramsKey, operation.params);
              expectedQueries.set(paramsKey, result);
              store.insertQueryResult("search", operation.params, result);
              break;
            }
            case "clearMemory": {
              expectedDocuments.clear();
              expectedQueries.clear();
              store.clearMemory();
              break;
            }
          }

          for (const id of seenDocumentIds) {
            expect(store.findInMemory("user", id)).toEqual(expectedDocuments.get(id));
          }

          for (const [paramsKey, params] of seenParams) {
            expect(store.findQueryInMemory("search", params)).toEqual(
              expectedQueries.get(paramsKey),
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
