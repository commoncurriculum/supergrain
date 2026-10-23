import { serialize } from "@supergrain/devtools";
import { createReactive } from "@supergrain/kernel";
import { describe, expect, it } from "vitest";

import { defineThrowingGetter } from "./fixtures";

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

describe("serialize() — values that throw on read", () => {
  const unreadableNope = { t: "unreadable", text: "Error: nope" } as const;

  it("degrades a throwing getter to an `unreadable` node and keeps its siblings", () => {
    const target: Record<string, unknown> = { before: 1 };
    defineThrowingGetter(target, "boom", new Error("nope"));
    target["after"] = 2;

    const node = serialize(target);
    expect(node.t).toBe("object");
    if (node.t !== "object") throw new Error("expected object");
    expect(node.entries).toEqual([
      ["before", { t: "number", value: 1, text: "1" }],
      ["boom", unreadableNope],
      ["after", { t: "number", value: 2, text: "2" }],
    ]);
  });

  it.each([
    {
      label: "an array",
      wrap: (bad: object) => [bad],
      expected: {
        t: "array",
        items: [{ t: "object", entries: [["boom", unreadableNope]], truncated: 0 }],
        truncated: 0,
      },
    },
    {
      label: "a map",
      wrap: (bad: object) => new Map([["k", bad]]),
      expected: {
        t: "map",
        entries: [["k", { t: "object", entries: [["boom", unreadableNope]], truncated: 0 }]],
        size: 1,
        truncated: 0,
      },
    },
    {
      label: "a set",
      wrap: (bad: object) => new Set([bad]),
      expected: {
        t: "set",
        items: [{ t: "object", entries: [["boom", unreadableNope]], truncated: 0 }],
        size: 1,
        truncated: 0,
      },
    },
  ])("degrades a throwing getter nested inside $label", ({ wrap, expected }) => {
    expect(serialize(wrap(defineThrowingGetter({}, "boom", new Error("nope"))))).toEqual(expected);
  });

  it("degrades an Error's own field that throws on read and keeps the message", () => {
    const node = serialize(defineThrowingGetter(new Error("outer"), "detail", new Error("nope")));
    expect(node).toEqual({
      t: "error",
      name: "Error",
      message: "outer",
      entries: [["detail", unreadableNope]],
    });
  });

  it.each([
    { label: "at the root", wrap: (proxy: object) => proxy, path: [] as Array<number | string> },
    { label: "in an object", wrap: (proxy: object) => ({ dead: proxy }), path: ["dead"] },
    { label: "in an array", wrap: (proxy: object) => [proxy], path: [0] },
  ])("degrades a revoked proxy $label rather than throwing", ({ wrap, path }) => {
    const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
    revoke();
    let node = serialize(wrap(proxy));
    for (const step of path) {
      if (node.t === "object") node = node.entries.find(([k]) => k === step)![1];
      else if (node.t === "array") node = node.items[step as number]!;
    }
    expect(node.t).toBe("unreadable");
  });

  it("falls back to a placeholder when the thrown value can't describe itself", () => {
    // Not an Error, and `String(thrown)` throws in turn — so even building the
    // `unreadable` text fails and the last-resort branch has to hold.
    const hostile = {
      toString() {
        throw new Error("cannot describe me");
      },
    };

    const node = serialize(defineThrowingGetter({}, "boom", hostile));
    expect(node.t).toBe("object");
    if (node.t !== "object") throw new Error("expected object");
    expect(node.entries[0]?.[1]).toEqual({
      t: "unreadable",
      text: "threw a value that could not be described",
    });
  });

  it("treats an Error whose `cause` throws on read as having no cause", () => {
    // `cause` is non-enumerable, so it's probed explicitly — and that probe is
    // itself a read that can throw.
    const error = defineThrowingGetter(new Error("outer"), "cause", new Error("cause exploded"), {
      enumerable: false,
    });

    const node = serialize(error);
    expect(node.t).toBe("error");
    if (node.t !== "error") throw new Error("expected error");
    expect(node.message).toBe("outer");
    expect(node.entries.map(([key]) => key)).not.toContain("cause");
  });
});
