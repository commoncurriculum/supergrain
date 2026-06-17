import { serialize } from "@supergrain/devtools";
import { describe, expect, it } from "vitest";

describe("serialize() — exotic values & limits", () => {
  it("renders symbols", () => {
    const node = serialize(Symbol("z"));
    expect(node.t).toBe("symbol");
    if (node.t === "symbol") expect(node.text).toContain("Symbol(z)");
  });

  it("labels anonymous functions", () => {
    expect(serialize(() => {})).toEqual({ t: "function", name: "anonymous" });
  });

  it("stringifies object map keys", () => {
    const node = serialize(new Map<unknown, number>([[{ a: 1 }, 1]]));
    if (node.t !== "map") throw new Error("expected map");
    expect(node.entries[0]![0]).toBe(`{"a":1}`);
  });

  it("falls back to String() for cyclic map keys", () => {
    const key: Record<string, unknown> = {};
    key["self"] = key;
    const node = serialize(new Map<unknown, number>([[key, 1]]));
    if (node.t !== "map") throw new Error("expected map");
    expect(typeof node.entries[0]![0]).toBe("string");
  });

  it("renders bigint map keys with the n suffix", () => {
    const node = serialize(new Map<unknown, string>([[10n, "v"]]));
    if (node.t !== "map") throw new Error("expected map");
    expect(node.entries[0]![0]).toBe("10n");
  });

  it("surfaces a non-enumerable Error cause", () => {
    const node = serialize(new Error("outer", { cause: new Error("inner") }));
    if (node.t !== "error") throw new Error("expected error");
    expect(node.entries.some(([k]) => k === "cause")).toBe(true);
  });

  it("does not duplicate an already-enumerable cause", () => {
    const node = serialize(Object.assign(new Error("outer"), { cause: "boom" }));
    if (node.t !== "error") throw new Error("expected error");
    expect(node.entries.filter(([k]) => k === "cause")).toHaveLength(1);
  });

  it("stringifies primitive and null map keys", () => {
    const node = serialize(
      new Map<unknown, string>([
        [42, "n"],
        [true, "b"],
        [null, "z"],
      ]),
    );
    if (node.t !== "map") throw new Error("expected map");
    const labels = node.entries.map(([k]) => k);
    expect(labels).toContain("42");
    expect(labels).toContain("true");
    expect(labels).toContain("null");
  });

  it("truncates maps and sets past maxEntries", () => {
    const map = serialize(
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]),
      { maxEntries: 2 },
    );
    if (map.t !== "map") throw new Error("expected map");
    expect(map.entries).toHaveLength(2);
    expect(map.truncated).toBe(1);

    const set = serialize(new Set([1, 2, 3]), { maxEntries: 2 });
    if (set.t !== "set") throw new Error("expected set");
    expect(set.items).toHaveLength(2);
    expect(set.truncated).toBe(1);
  });

  it("truncates error own-keys past maxEntries", () => {
    const error = Object.assign(new Error("boom"), { a: 1, b: 2, c: 3 });
    const node = serialize(error, { maxEntries: 1 });
    if (node.t !== "error") throw new Error("expected error");
    expect(node.entries.length).toBeLessThanOrEqual(1);
  });
});
