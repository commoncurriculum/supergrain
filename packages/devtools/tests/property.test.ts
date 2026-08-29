// Property-based coverage for `serialize()`.
//
// `serialize` is the one function in devtools that is handed *arbitrary
// application data* — whatever happens to sit in a silo document. Its whole
// job is to be total: never throw, never loop, never hand the renderer
// something it can't walk. Those are universal claims over an unbounded input
// space, which is exactly what example tests can't cover and fast-check can.

import { serialize, type JsonNode, type SerializeOptions } from "@supergrain/devtools";
import { createReactive } from "@supergrain/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/** Every exotic shape `serialize` claims to handle, plus cycles. */
const anythingArbitrary = fc.anything({
  withBigInt: true,
  withBoxedValues: true,
  withDate: true,
  withMap: true,
  withNullPrototype: true,
  withObjectString: true,
  withSet: true,
  withSparseArray: true,
  withTypedArray: true,
  withUnicodeString: true,
  maxDepth: 4,
  maxKeys: 6,
});

/** Direct children of a node, in the order `serialize` emitted them. */
function childrenOf(node: JsonNode): Array<JsonNode> {
  switch (node.t) {
    case "array":
    case "set": {
      return [...node.items];
    }
    case "object":
    case "map":
    case "error": {
      return node.entries.map(([, child]) => child);
    }
    default: {
      return [];
    }
  }
}

/** Every node in the tree paired with its depth (root = 0). */
function walkNodes(root: JsonNode): Array<{ node: JsonNode; depth: number }> {
  const out: Array<{ node: JsonNode; depth: number }> = [];
  const stack: Array<{ node: JsonNode; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    out.push(entry);
    for (const child of childrenOf(entry.node)) {
      stack.push({ node: child, depth: entry.depth + 1 });
    }
  }
  return out;
}

const COMPOSITE_KINDS = new Set(["array", "object", "map", "set", "error"]);

describe("serialize — totality", () => {
  it("never throws on arbitrary values", () => {
    fc.assert(
      fc.property(anythingArbitrary, (value) => {
        expect(() => serialize(value)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it("never throws for any depth/entry cap combination", () => {
    fc.assert(
      fc.property(
        anythingArbitrary,
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        (value, maxDepth, maxEntries) => {
          expect(() => serialize(value, { maxDepth, maxEntries })).not.toThrow();
        },
      ),
      { numRuns: 300 },
    );
  });

  it("always produces a node with a known tag", () => {
    const tags = new Set([
      "null",
      "undefined",
      "boolean",
      "number",
      "string",
      "bigint",
      "date",
      "symbol",
      "function",
      "error",
      "array",
      "object",
      "map",
      "set",
      "circular",
      "max-depth",
    ]);
    fc.assert(
      fc.property(anythingArbitrary, (value) => {
        for (const { node } of walkNodes(serialize(value))) {
          expect(tags.has(node.t)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("serialize — the result is plain and finite", () => {
  it("is always JSON-serializable (no cycles, no bigint, no proxies leaked)", () => {
    fc.assert(
      fc.property(anythingArbitrary, (value) => {
        // JSON.stringify throws on a cycle and on a bigint, and would be the
        // renderer's first casualty if either survived the walk.
        expect(() => JSON.stringify(serialize(value))).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it("carries only primitive payloads — every leaf field is a string/number/boolean", () => {
    fc.assert(
      fc.property(anythingArbitrary, (value) => {
        for (const { node } of walkNodes(serialize(value))) {
          for (const [key, field] of Object.entries(node)) {
            if (key === "items" || key === "entries") continue;
            expect(["string", "number", "boolean"]).toContain(typeof field);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("serialize — depth cap", () => {
  it("emits no node deeper than maxDepth, and no composite at maxDepth", () => {
    fc.assert(
      fc.property(anythingArbitrary, fc.integer({ min: 0, max: 6 }), (value, maxDepth) => {
        for (const { node, depth } of walkNodes(serialize(value, { maxDepth }))) {
          expect(depth).toBeLessThanOrEqual(maxDepth);
          if (COMPOSITE_KINDS.has(node.t)) {
            expect(depth).toBeLessThan(maxDepth);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("terminates on a chain far deeper than the cap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 5 }), (chain, cap) => {
        let deep: Record<string, unknown> = { leaf: 1 };
        for (let i = 0; i < chain; i++) deep = { next: deep };

        const node = serialize(deep, { maxDepth: cap });
        const depths = walkNodes(node).map((entry) => entry.depth);
        expect(Math.max(...depths)).toBeLessThanOrEqual(cap);
        // Anything genuinely deeper than the cap has to be reported, not dropped.
        if (chain >= cap) {
          expect(walkNodes(node).some((entry) => entry.node.t === "max-depth")).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("serialize — breadth cap and truncation accounting", () => {
  it("arrays: emitted items + truncated === the real length", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 40 }),
        fc.integer({ min: 0, max: 20 }),
        (items, maxEntries) => {
          const node = serialize(items, { maxEntries });
          expect(node.t).toBe("array");
          if (node.t !== "array") return;
          expect(node.items.length).toBeLessThanOrEqual(maxEntries);
          expect(node.items.length + node.truncated).toBe(items.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("objects: emitted entries + truncated === the real key count", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), fc.integer(), { maxKeys: 30 }),
        fc.integer({ min: 0, max: 20 }),
        (dict, maxEntries) => {
          const node = serialize(dict, { maxEntries });
          expect(node.t).toBe("object");
          if (node.t !== "object") return;
          expect(node.entries.length).toBeLessThanOrEqual(maxEntries);
          expect(node.entries.length + node.truncated).toBe(Object.keys(dict).length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("maps and sets: size is the real size and emitted + truncated === size", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.string({ maxLength: 4 }), fc.integer()), { maxLength: 30 }),
        fc.integer({ min: 0, max: 20 }),
        (pairs, maxEntries) => {
          const map = new Map(pairs);
          const mapNode = serialize(map, { maxEntries });
          expect(mapNode.t).toBe("map");
          if (mapNode.t === "map") {
            expect(mapNode.size).toBe(map.size);
            expect(mapNode.entries.length).toBeLessThanOrEqual(maxEntries);
            expect(mapNode.entries.length + mapNode.truncated).toBe(map.size);
          }

          const set = new Set(pairs.map(([, value]) => value));
          const setNode = serialize(set, { maxEntries });
          expect(setNode.t).toBe("set");
          if (setNode.t === "set") {
            expect(setNode.size).toBe(set.size);
            expect(setNode.items.length).toBeLessThanOrEqual(maxEntries);
            expect(setNode.items.length + setNode.truncated).toBe(set.size);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no composite node ever exceeds maxEntries children", () => {
    fc.assert(
      fc.property(anythingArbitrary, fc.integer({ min: 0, max: 6 }), (value, maxEntries) => {
        for (const { node } of walkNodes(serialize(value, { maxEntries }))) {
          if (COMPOSITE_KINDS.has(node.t)) {
            expect(childrenOf(node).length).toBeLessThanOrEqual(maxEntries);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("serialize — cycles versus shared references", () => {
  it("terminates and reports `circular` for a self-referencing object at any insertion point", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), (depth) => {
        const root: Record<string, unknown> = {};
        let cursor = root;
        for (let i = 0; i < depth; i++) {
          const next: Record<string, unknown> = {};
          cursor["child"] = next;
          cursor = next;
        }
        cursor["loop"] = root;

        const node = serialize(root, { maxDepth: 10 });
        expect(walkNodes(node).some((entry) => entry.node.t === "circular")).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it("a shared (non-cyclic) reference is expanded every time, never flagged circular", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: -50, max: 50 }),
        (fanout, v) => {
          const shared = { v };
          const root: Record<string, unknown> = {};
          for (let i = 0; i < fanout; i++) root[`k${i}`] = shared;

          const node = serialize(root, { maxDepth: 6 });
          expect(walkNodes(node).some((entry) => entry.node.t === "circular")).toBe(false);
          expect(node.t).toBe("object");
          if (node.t !== "object") return;
          expect(node.entries).toHaveLength(fanout);
          for (const [, child] of node.entries) {
            expect(child).toEqual({
              t: "object",
              entries: [["v", { t: "number", value: v, text: String(v) }]],
              truncated: 0,
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a cycle through an array terminates", () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 5 }), (values) => {
        const arr: Array<unknown> = [...values];
        arr.push(arr);
        expect(() => serialize(arr, { maxDepth: 8 })).not.toThrow();
        expect(
          walkNodes(serialize(arr, { maxDepth: 8 })).some((e) => e.node.t === "circular"),
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe("serialize — reactive transparency", () => {
  const plainArbitrary = fc.letrec<{ value: unknown }>((tie) => ({
    value: fc.oneof(
      { maxDepth: 3 },
      fc.integer(),
      fc.string({ maxLength: 4 }),
      fc.boolean(),
      fc.constant(null),
      fc.array(tie("value"), { maxLength: 4 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), tie("value"), { maxKeys: 4 }),
    ),
  })).value;

  it("serializing through a reactive proxy matches serializing the raw value", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.array(plainArbitrary, { maxLength: 5 }),
          fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), plainArbitrary, { maxKeys: 5 }),
        ),
        (value) => {
          const reactive = createReactive(structuredClone(value) as object);
          expect(serialize(reactive)).toEqual(serialize(value));
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("serialize — round-trip for JSON-shaped data", () => {
  const jsonArbitrary = fc.letrec<{ value: unknown }>((tie) => ({
    value: fc.oneof(
      { maxDepth: 3 },
      fc.integer({ min: -1000, max: 1000 }),
      fc.string({ maxLength: 4 }),
      fc.boolean(),
      fc.constant(null),
      fc.array(tie("value"), { maxLength: 4 }),
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 3 }).filter((key) => key !== "__proto__"),
        tie("value"),
        { maxKeys: 4 },
      ),
    ),
  })).value;

  function decode(node: JsonNode): unknown {
    switch (node.t) {
      case "null": {
        return null;
      }
      case "boolean":
      case "number":
      case "string": {
        return node.value;
      }
      case "array": {
        return node.items.map(decode);
      }
      case "object": {
        const out: Record<string, unknown> = {};
        for (const [key, child] of node.entries) {
          Object.defineProperty(out, key, {
            value: decode(child),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        return out;
      }
      default: {
        throw new Error(`unexpected node kind for JSON-shaped input: ${node.t}`);
      }
    }
  }

  it("decoding the node tree reproduces the input when nothing is capped", () => {
    const options: SerializeOptions = { maxDepth: 20, maxEntries: 100 };
    fc.assert(
      fc.property(jsonArbitrary, (value) => {
        expect(decode(serialize(value, options))).toEqual(value);
      }),
      { numRuns: 300 },
    );
  });
});

describe("serialize — hostile values", () => {
  it("survives a property getter that throws, at any position in the object", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 5 }),
        fc.nat(),
        (keys, offset) => {
          const unique = [...new Set(keys)];
          const boomKey = unique[offset % unique.length]!;
          const target: Record<string, unknown> = {};
          for (const key of unique) {
            if (key === boomKey) {
              Object.defineProperty(target, key, {
                enumerable: true,
                get() {
                  throw new Error("getter exploded");
                },
              });
            } else {
              target[key] = 1;
            }
          }

          expect(() => serialize(target)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("survives a throwing getter nested inside arrays, maps, and sets", () => {
    const hostile = () => {
      const target: Record<string, unknown> = {};
      Object.defineProperty(target, "boom", {
        enumerable: true,
        get() {
          throw new Error("getter exploded");
        },
      });
      return target;
    };

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), (kind) => {
        const wrapped = [hostile(), [hostile()], new Map([["k", hostile()]]), new Set([hostile()])][
          kind
        ];
        expect(() => serialize(wrapped)).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });

  it("survives an Error whose own fields throw on read", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 8 }), (message) => {
        const error = new Error(message);
        Object.defineProperty(error, "detail", {
          enumerable: true,
          get() {
            throw new Error("detail exploded");
          },
        });
        expect(() => serialize(error)).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });

  it("survives a Map keyed by a cyclic object", () => {
    fc.assert(
      fc.property(fc.integer(), (value) => {
        const key: Record<string, unknown> = {};
        key["self"] = key;
        expect(() => serialize(new Map([[key, value]]))).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });

  it("survives a revoked proxy anywhere in the tree", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 }), (kind) => {
        const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
        revoke();
        const wrapped = [proxy, { nested: proxy }, [proxy]][kind];
        expect(() => serialize(wrapped)).not.toThrow();
      }),
      { numRuns: 30 },
    );
  });
});
