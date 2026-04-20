/**
 * Type-level tests for Branded<T> on createReactive return type.
 *
 * These tests verify that createReactive returns Branded<T> with $BRAND
 * at all nesting levels. No runtime assertions -- if it compiles, it passes.
 */

import { update } from "@supergrain/operators";
import { describe, it, expect } from "vitest";

import { createReactive, $BRAND, type Branded } from "../../src";

// ---------------------------------------------------------------------------
// Type assertion helpers
// ---------------------------------------------------------------------------

type AssertBranded<T> = typeof $BRAND extends keyof T ? true : false;
type Assert<T extends true> = T;

// ---------------------------------------------------------------------------
// 1. createReactive return type has $BRAND at top level
// ---------------------------------------------------------------------------

const simpleStore = createReactive({ name: "test", count: 0 });
export type _1 = Assert<AssertBranded<typeof simpleStore>>;

// ---------------------------------------------------------------------------
// 2. Nested objects have $BRAND at all levels
// ---------------------------------------------------------------------------

const nestedStore = createReactive({
  a: { b: { c: 42 } },
});
export type _2a = Assert<AssertBranded<typeof nestedStore>>;
export type _2b = Assert<AssertBranded<(typeof nestedStore)["a"]>>;
export type _2c = Assert<AssertBranded<(typeof nestedStore)["a"]["b"]>>;
// Leaf primitive passes through unchanged
export type _2d = Assert<(typeof nestedStore)["a"]["b"]["c"] extends number ? true : false>;

// ---------------------------------------------------------------------------
// 3. Array items have $BRAND, arrays themselves do NOT
// ---------------------------------------------------------------------------

const arrayStore = createReactive({
  items: [{ id: "1", label: "first" }],
});
export type _3a = Assert<AssertBranded<typeof arrayStore>>;
// Array items are branded
export type _3b = Assert<AssertBranded<(typeof arrayStore)["items"][0]>>;
// Array itself is NOT branded (arrays aren't store objects with $NODE)
type ArrayType = (typeof arrayStore)["items"];
export type _3c = Assert<ArrayType extends Array<any> ? true : false>;

// ---------------------------------------------------------------------------
// 4. Primitives pass through unchanged
// ---------------------------------------------------------------------------

export type _4a = Assert<Branded<string> extends string ? true : false>;
export type _4b = Assert<Branded<number> extends number ? true : false>;
export type _4c = Assert<Branded<boolean> extends boolean ? true : false>;
export type _4d = Assert<Branded<null> extends null ? true : false>;
export type _4e = Assert<Branded<undefined> extends undefined ? true : false>;

// ---------------------------------------------------------------------------
// 5. Optional properties are preserved
// ---------------------------------------------------------------------------

const optionalStore = createReactive<{ title?: string | null; required: string }>({
  required: "yes",
});
type OptStore = typeof optionalStore;
export type _5a = Assert<AssertBranded<OptStore>>;
export type _5b = Assert<undefined extends OptStore["title"] ? true : false>;
export type _5c = Assert<null extends OptStore["title"] ? true : false>;

// ---------------------------------------------------------------------------
// Runtime: existing behavior unchanged (createReactive still works at runtime)
// ---------------------------------------------------------------------------

describe("Branded type - runtime behavior unchanged", () => {
  it("createReactive still returns working reactive proxy", () => {
    const state = createReactive({ count: 0, nested: { value: "hello" } });
    expect(state.count).toBe(0);
    expect(state.nested.value).toBe("hello");
    update(state, { $set: { count: 5 } });
    expect(state.count).toBe(5);
  });

  it("arrays still work at runtime", () => {
    const state = createReactive({ items: [{ id: "1" }] });
    expect(state.items[0]?.id).toBe("1");
    update(state, { $push: { items: { id: "2" } } });
    expect(state.items.length).toBe(2);
  });
});
