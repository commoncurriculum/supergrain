import { describe, expect, it } from "vitest";

import {
  deleteValueAtPath,
  getValueAtPath,
  hasValueAtPath,
  setValueAtPath,
  splitPath,
} from "../src/path";

// Direct coverage of the internal path-navigation helpers. The operators are
// exercised through `update()` elsewhere; these pin the helper contracts —
// including the defensive branches the operators never reach because they
// pre-check existence.

describe("splitPath", () => {
  it("splits a dotted path into segments", () => {
    expect(splitPath("a.b.c")).toEqual(["a", "b", "c"]);
  });

  it("rejects an empty path", () => {
    expect(() => splitPath("")).toThrow(/must not be empty/i);
  });

  it("rejects empty segments", () => {
    expect(() => splitPath("a..b")).toThrow(/empty path segments/i);
  });
});

describe("getValueAtPath", () => {
  it("reads a nested value", () => {
    expect(getValueAtPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns undefined when a segment is missing", () => {
    expect(getValueAtPath({ a: {} }, "a.b.c")).toBeUndefined();
  });

  it("returns undefined when a segment is a non-container", () => {
    expect(getValueAtPath({ a: 5 }, "a.b")).toBeUndefined();
  });
});

describe("hasValueAtPath", () => {
  it("is true for a present leaf", () => {
    expect(hasValueAtPath({ a: { b: 1 } }, "a.b")).toBe(true);
  });

  it("is false for a missing leaf", () => {
    expect(hasValueAtPath({ a: { b: 1 } }, "a.c")).toBe(false);
  });

  it("is false when the parent is not a container", () => {
    expect(hasValueAtPath({ a: 5 }, "a.b")).toBe(false);
  });

  it("treats a present-but-undefined value as present", () => {
    expect(hasValueAtPath({ a: undefined }, "a")).toBe(true);
  });
});

describe("deleteValueAtPath", () => {
  it("deletes a present leaf", () => {
    const target: Record<string, unknown> = { a: { b: 1 } };
    deleteValueAtPath(target, "a.b");
    expect(target).toEqual({ a: {} });
  });

  it("is a no-op when the leaf is absent", () => {
    const target: Record<string, unknown> = { a: { b: 1 } };
    deleteValueAtPath(target, "a.c");
    expect(target).toEqual({ a: { b: 1 } });
  });

  it("is a no-op when an intermediate segment is missing", () => {
    const target: Record<string, unknown> = { a: 5 };
    deleteValueAtPath(target, "a.b.c");
    expect(target).toEqual({ a: 5 });
  });
});

describe("setValueAtPath", () => {
  it("creates intermediate objects as needed", () => {
    const target: Record<string, unknown> = {};
    setValueAtPath(target, "a.b.c", 1);
    expect(target).toEqual({ a: { b: { c: 1 } } });
  });

  it("rejects creating a field inside a non-container intermediate", () => {
    const target: Record<string, unknown> = { a: 5 };
    expect(() => setValueAtPath(target, "a.b", 1)).toThrow(/cannot create field/i);
    expect(target).toEqual({ a: 5 });
  });
});
