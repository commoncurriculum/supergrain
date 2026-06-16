import { serialize } from "@supergrain/devtools";
import { createReactive } from "@supergrain/kernel";
import { describe, expect, it } from "vitest";

describe("serialize()", () => {
  it("handles primitives", () => {
    expect(serialize(null)).toEqual({ t: "null" });
    expect(serialize(undefined)).toEqual({ t: "undefined" });
    expect(serialize(true)).toEqual({ t: "boolean", value: true });
    expect(serialize("hi")).toEqual({ t: "string", value: "hi" });
    expect(serialize(42)).toEqual({ t: "number", value: 42, text: "42" });
  });

  it("encodes non-finite numbers and bigints distinctly", () => {
    expect(serialize(NaN)).toEqual({ t: "number", value: NaN, text: "NaN" });
    expect(serialize(Infinity)).toMatchObject({ t: "number", text: "Infinity" });
    expect(serialize(-Infinity)).toMatchObject({ t: "number", text: "-Infinity" });
    expect(serialize(10n)).toEqual({ t: "bigint", text: "10n" });
  });

  it("renders Date and functions as leaf nodes", () => {
    const d = new Date("2026-06-16T00:00:00.000Z");
    expect(serialize(d)).toEqual({ t: "date", text: "2026-06-16T00:00:00.000Z" });
    expect(serialize(new Date("nope"))).toEqual({ t: "date", text: "Invalid Date" });
    expect(serialize(function foo() {})).toEqual({ t: "function", name: "foo" });
    expect(serialize(() => {})).toMatchObject({ t: "function" });
  });

  it("walks nested objects and arrays", () => {
    const node = serialize({ a: 1, b: [2, 3], c: { d: "x" } });
    expect(node.t).toBe("object");
    if (node.t !== "object") throw new Error("expected object");
    expect(node.entries.map(([k]) => k)).toEqual(["a", "b", "c"]);
    const b = node.entries.find(([k]) => k === "b")?.[1];
    expect(b?.t).toBe("array");
  });

  it("serializes Map and Set", () => {
    const map = serialize(new Map([["k", 1]]));
    expect(map).toMatchObject({ t: "map", size: 1 });
    const set = serialize(new Set([1, 2]));
    expect(set).toMatchObject({ t: "set", size: 2 });
  });

  it("surfaces Error tag, message, and own fields", () => {
    class Tagged extends Error {
      readonly _tag = "AdapterError";
      readonly keys = ["1", "2"];
      constructor() {
        super("boom");
      }
    }
    const node = serialize(new Tagged());
    expect(node.t).toBe("error");
    if (node.t !== "error") throw new Error("expected error");
    expect(node.name).toBe("AdapterError");
    expect(node.message).toBe("boom");
    expect(node.entries.some(([k]) => k === "keys")).toBe(true);
  });

  it("detects cycles instead of looping forever", () => {
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    const node = serialize(a);
    if (node.t !== "object") throw new Error("expected object");
    const self = node.entries.find(([k]) => k === "self")?.[1];
    expect(self).toEqual({ t: "circular" });
  });

  it("caps depth and breadth", () => {
    const deep = serialize({ a: { b: { c: { d: {} } } } }, { maxDepth: 2 });
    if (deep.t !== "object") throw new Error("expected object");
    const a = deep.entries[0]?.[1];
    if (a?.t !== "object") throw new Error("expected nested object");
    expect(a.entries[0]?.[1]).toEqual({ t: "max-depth" });

    const wide = serialize([1, 2, 3, 4, 5], { maxEntries: 2 });
    if (wide.t !== "array") throw new Error("expected array");
    expect(wide.items).toHaveLength(2);
    expect(wide.truncated).toBe(3);
  });

  it("reads through reactive proxies", () => {
    const state = createReactive({ user: { id: "1", name: "Ada" } });
    const node = serialize(state.user);
    if (node.t !== "object") throw new Error("expected object");
    expect(node.entries.find(([k]) => k === "name")?.[1]).toEqual({ t: "string", value: "Ada" });
  });
});
