// =============================================================================
// types.test-d.ts
// =============================================================================
//
// Type-level tests for `update(state, ops)` — the path-typed key surface is
// where mill's generic plumbing actually earns its complexity. These tests
// pin that:
//
//   - `$set` / `$unset` / `$inc` / `$push` / `$pull` / `$min` / `$max` reject
//     unknown paths and mismatched value shapes.
//   - `$inc`, `$min`, `$max` reject non-numeric paths.
//   - `$push` / `$pull` / `$addToSet` reject non-array paths.
//
// Runtime no-op; everything below is checked by `tsc --noEmit`.
// =============================================================================
import { describe, it } from "vitest";

import { update } from "../src/operators";

interface Address {
  street: string;
  city: string;
  zip: number;
}

interface User {
  id: string;
  name: string;
  age: number;
  address: Address;
  tags: Array<string>;
  scores: Array<number>;
  followers: number;
}

describe("update — $set", () => {
  const state = {} as User;

  it("accepts a known path with a matching value", () => {
    update(state, { $set: { name: "x" } });
    update(state, { $set: { age: 30 } });
    update(state, { $set: { "address.city": "Boston" } });
    update(state, { $set: { "address.zip": 12345 } });
  });

  it("rejects an unknown top-level path", () => {
    // @ts-expect-error -- "unknown" is not a key of User
    update(state, { $set: { unknown: "x" } });
  });

  it("rejects an unknown nested path", () => {
    // @ts-expect-error -- "address.country" is not a path on User
    update(state, { $set: { "address.country": "USA" } });
  });

  it("rejects a wrong value type at a known path", () => {
    // @ts-expect-error -- name is a string
    update(state, { $set: { name: 123 } });
  });

  it("rejects a wrong nested value type", () => {
    // @ts-expect-error -- zip is a number
    update(state, { $set: { "address.zip": "12345" } });
  });
});

describe("update — $inc / $min / $max (numeric-only)", () => {
  const state = {} as User;

  it("accepts numeric paths", () => {
    update(state, { $inc: { age: 1 } });
    update(state, { $inc: { followers: 10 } });
    update(state, { $inc: { "address.zip": 1 } });
    update(state, { $min: { age: 0 } });
    update(state, { $max: { age: 120 } });
  });

  it("rejects a string path under $inc", () => {
    // @ts-expect-error -- name is not a numeric path
    update(state, { $inc: { name: 1 } });
  });

  it("rejects a string path under $min/$max", () => {
    // @ts-expect-error -- name is not a numeric path
    update(state, { $min: { name: 1 } });
    // @ts-expect-error -- name is not a numeric path
    update(state, { $max: { name: 1 } });
  });

  it("rejects a non-number value at a numeric path", () => {
    // @ts-expect-error -- $inc requires a number
    update(state, { $inc: { age: "1" } });
  });
});

describe("update — $push / $addToSet (array-only)", () => {
  const state = {} as User;

  it("accepts array paths with matching element types", () => {
    update(state, { $push: { tags: "javascript" } });
    update(state, { $push: { scores: 100 } });
    update(state, { $addToSet: { tags: "rust" } });
  });

  it("rejects a non-array path", () => {
    // @ts-expect-error -- name is not an array path
    update(state, { $push: { name: "x" } });
  });

  it("rejects a wrong element type", () => {
    // @ts-expect-error -- scores holds numbers
    update(state, { $push: { scores: "100" } });
  });
});

describe("update — $unset", () => {
  const state = {} as User;

  it("accepts known paths", () => {
    update(state, { $unset: { name: 1 } });
    update(state, { $unset: { "address.city": 1 } });
  });

  it("rejects unknown paths", () => {
    // @ts-expect-error -- "ghost" is not a key
    update(state, { $unset: { ghost: 1 } });
  });
});

describe("update — operator combinations", () => {
  const state = {} as User;

  it("accepts multiple operators in one call with consistent typing", () => {
    update(state, {
      $set: { name: "x" },
      $inc: { age: 1 },
      $push: { tags: "ts" },
    });
  });

  it("rejects when one operator has a wrong type even if others are valid", () => {
    update(state, {
      $set: { name: "x" },
      // @ts-expect-error -- age must be a number under $inc
      $inc: { age: "1" },
    });
  });
});
