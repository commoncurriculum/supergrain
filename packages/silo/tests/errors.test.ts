// =============================================================================
// tests/errors.test.ts
// =============================================================================
//
// Pins the public error classes in `src/errors.ts`: each is a Data.TaggedError
// (discriminated on `_tag`), still `instanceof Error`, and carries a
// non-empty, type-mentioning `.message`.
// =============================================================================

import { describe, expect, it } from "vitest";

import { AdapterError, NotFoundError, ProcessorError } from "../src";

describe("AdapterError", () => {
  const e = new AdapterError({ type: "user", keys: ["1", "2"], cause: new Error("net") });

  it("has the correct _tag and is an Error", () => {
    expect(e._tag).toBe("AdapterError");
    expect(e).toBeInstanceOf(Error);
  });

  it("has a non-empty message mentioning the type and keys", () => {
    expect(typeof e.message).toBe("string");
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.message).toContain("user");
    expect(e.message).toContain("1");
    expect(e.message).toContain("2");
  });

  it("retains the underlying cause", () => {
    expect((e.cause as Error).message).toBe("net");
  });
});

describe("NotFoundError", () => {
  const e = new NotFoundError({ type: "post", key: "42" });

  it("has the correct _tag and is an Error", () => {
    expect(e._tag).toBe("NotFoundError");
    expect(e).toBeInstanceOf(Error);
  });

  it("has a non-empty message mentioning the type and key", () => {
    expect(typeof e.message).toBe("string");
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.message).toContain("post");
    expect(e.message).toContain("42");
  });
});

describe("ProcessorError", () => {
  const e = new ProcessorError({ type: "dashboard", cause: new Error("threw") });

  it("has the correct _tag and is an Error", () => {
    expect(e._tag).toBe("ProcessorError");
    expect(e).toBeInstanceOf(Error);
  });

  it("has a non-empty message mentioning the type", () => {
    expect(typeof e.message).toBe("string");
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.message).toContain("dashboard");
  });
});
