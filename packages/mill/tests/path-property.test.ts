// Property-based coverage for the dotted-path layer (`src/path.ts`).
//
// Every operator in mill routes its writes through these five functions, so a
// defect here is a defect in `$set`, `$unset`, `$inc`, `$push` — all of them at
// once. The properties below are the algebraic laws the rest of mill assumes:
// split/join round-trips, `pathCovers` is a genuine prefix order, and
// set/get/has/delete agree with each other on every path they accept.

import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import { update } from "../src";
import {
  deleteValueAtPath,
  getValueAtPath,
  hasValueAtPath,
  isArrayIndex,
  pathCovers,
  pathsConflict,
  setValueAtPath,
  splitPath,
  unsetValueAtPath,
} from "../src/path";

const WRITE = { allowNullIntermediates: false };

// A deliberately prefix-heavy alphabet: "a"/"ab" and "1"/"12" are exactly the
// pairs a string-prefix implementation of `pathCovers` gets wrong.
const segmentArbitrary = fc.constantFrom("a", "ab", "abc", "b", "0", "1", "12", "x_y", "é");

const pathArbitrary = fc
  .array(segmentArbitrary, { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join("."));

/** Segment-wise reference for `pathCovers`, written the obvious slow way. */
function pathCoversReference(ancestor: string, path: string): boolean {
  const a = ancestor.split(".");
  const p = path.split(".");
  if (a.length > p.length) return false;
  return a.every((segment, index) => segment === p[index]);
}

describe("splitPath — round-trip and rejection", () => {
  it("joining the segments reproduces the path", () => {
    fc.assert(
      fc.property(pathArbitrary, (path) => {
        expect(splitPath(path).join(".")).toBe(path);
      }),
      { numRuns: 300 },
    );
  });

  it("yields one segment per dot-separated part, each non-empty", () => {
    fc.assert(
      fc.property(fc.array(segmentArbitrary, { minLength: 1, maxLength: 4 }), (segments) => {
        expect(splitPath(segments.join("."))).toEqual(segments);
      }),
      { numRuns: 300 },
    );
  });

  it("rejects every path containing an empty segment", () => {
    fc.assert(
      fc.property(
        fc.array(segmentArbitrary, { maxLength: 3 }),
        fc.array(segmentArbitrary, { maxLength: 3 }),
        (before, after) => {
          const path = [...before, "", ...after].join(".");
          expect(() => splitPath(path)).toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("pathCovers / pathsConflict — the prefix order", () => {
  it("agrees with a segment-wise reference implementation", () => {
    fc.assert(
      fc.property(pathArbitrary, pathArbitrary, (a, b) => {
        expect(pathCovers(a, b)).toBe(pathCoversReference(a, b));
      }),
      { numRuns: 1000 },
    );
  });

  it("is reflexive", () => {
    fc.assert(
      fc.property(pathArbitrary, (path) => {
        expect(pathCovers(path, path)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("is antisymmetric — mutual coverage implies equality", () => {
    fc.assert(
      fc.property(pathArbitrary, pathArbitrary, (a, b) => {
        if (pathCovers(a, b) && pathCovers(b, a)) expect(a).toBe(b);
      }),
      { numRuns: 1000 },
    );
  });

  it("is transitive", () => {
    fc.assert(
      fc.property(pathArbitrary, pathArbitrary, pathArbitrary, (a, b, c) => {
        if (pathCovers(a, b) && pathCovers(b, c)) expect(pathCovers(a, c)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("an ancestor covers every extension of itself, and nothing shorter", () => {
    fc.assert(
      fc.property(pathArbitrary, fc.array(segmentArbitrary, { maxLength: 3 }), (base, extra) => {
        const extended = [base, ...extra].join(".");
        expect(pathCovers(base, extended)).toBe(true);
        if (extra.length > 0) expect(pathCovers(extended, base)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("pathsConflict is symmetric, reflexive, and exactly two-way coverage", () => {
    fc.assert(
      fc.property(pathArbitrary, pathArbitrary, (a, b) => {
        expect(pathsConflict(a, b)).toBe(pathsConflict(b, a));
        expect(pathsConflict(a, a)).toBe(true);
        expect(pathsConflict(a, b)).toBe(pathCovers(a, b) || pathCovers(b, a));
      }),
      { numRuns: 1000 },
    );
  });

  it("sibling paths never conflict", () => {
    fc.assert(
      fc.property(pathArbitrary, segmentArbitrary, segmentArbitrary, (base, left, right) => {
        fc.pre(left !== right);
        expect(pathsConflict(`${base}.${left}`, `${base}.${right}`)).toBe(false);
      }),
      { numRuns: 400 },
    );
  });
});

describe("isArrayIndex", () => {
  it("accepts exactly the non-negative integer literals", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (n) => {
        expect(isArrayIndex(String(n))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects negatives, decimals, and anything with a non-digit", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -10_000, max: -1 }).map(String),
          fc.float({ min: Math.fround(0.1), max: 999, noInteger: true }).map(String),
          fc.string({ minLength: 1, maxLength: 5 }).filter((s) => !/^\d+$/u.test(s)),
        ),
        (segment) => {
          expect(isArrayIndex(segment)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("set / get / has / delete — mutual agreement", () => {
  // Values distinguishable by `===`, including the ones that trip up
  // presence checks (`undefined`, `null`, `NaN`, `0`).
  const valueArbitrary = fc.oneof(
    fc.integer({ min: -50, max: 50 }),
    fc.string({ maxLength: 4 }),
    fc.boolean(),
    fc.constant(null),
    fc.constant(0),
  );

  it("get after set returns exactly what was set", () => {
    fc.assert(
      fc.property(pathArbitrary, valueArbitrary, (path, value) => {
        const target: Record<string, unknown> = {};
        setValueAtPath(target, path, value, WRITE);
        expect(getValueAtPath(target, path)).toBe(value);
      }),
      { numRuns: 500 },
    );
  });

  it("has is true after set, for every value including null and undefined", () => {
    fc.assert(
      fc.property(
        pathArbitrary,
        fc.oneof(valueArbitrary, fc.constant(undefined)),
        (path, value) => {
          const target: Record<string, unknown> = {};
          setValueAtPath(target, path, value, WRITE);
          expect(hasValueAtPath(target, path)).toBe(true);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("set is idempotent — writing the same value twice leaves the same document", () => {
    fc.assert(
      fc.property(pathArbitrary, valueArbitrary, (path, value) => {
        const once: Record<string, unknown> = {};
        setValueAtPath(once, path, value, WRITE);
        const twice: Record<string, unknown> = {};
        setValueAtPath(twice, path, value, WRITE);
        setValueAtPath(twice, path, value, WRITE);
        expect(twice).toEqual(once);
      }),
      { numRuns: 300 },
    );
  });

  it("set then delete leaves no value, and delete is idempotent", () => {
    fc.assert(
      fc.property(pathArbitrary, valueArbitrary, (path, value) => {
        const target: Record<string, unknown> = {};
        setValueAtPath(target, path, value, WRITE);
        deleteValueAtPath(target, path);
        expect(hasValueAtPath(target, path)).toBe(false);
        expect(getValueAtPath(target, path)).toBeUndefined();
        expect(() => deleteValueAtPath(target, path)).not.toThrow();
        expect(hasValueAtPath(target, path)).toBe(false);
      }),
      { numRuns: 400 },
    );
  });

  it("delete removes only its own leaf — siblings survive", () => {
    fc.assert(
      fc.property(
        pathArbitrary,
        segmentArbitrary,
        segmentArbitrary,
        valueArbitrary,
        valueArbitrary,
        (base, left, right, leftValue, rightValue) => {
          fc.pre(left !== right);
          const target: Record<string, unknown> = {};
          setValueAtPath(target, `${base}.${left}`, leftValue, WRITE);
          setValueAtPath(target, `${base}.${right}`, rightValue, WRITE);

          deleteValueAtPath(target, `${base}.${left}`);

          expect(hasValueAtPath(target, `${base}.${left}`)).toBe(false);
          expect(getValueAtPath(target, `${base}.${right}`)).toBe(rightValue);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("get never throws on a syntactically valid path, however absent", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant<unknown>({}),
          fc.constant<unknown>([]),
          fc.constant<unknown>(null),
          fc.constant<unknown>(42),
          fc.constant<unknown>("str"),
          fc.constant<unknown>({ a: { b: 1 } }),
          fc.constant<unknown>({ a: [1, 2, 3] }),
        ),
        pathArbitrary,
        (target, path) => {
          expect(() => getValueAtPath(target, path)).not.toThrow();
          expect(() => hasValueAtPath(target, path)).not.toThrow();
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("array writes — padding and unset semantics", () => {
  it("writing past the end pads with null and preserves the existing elements", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -20, max: 20 }), { maxLength: 5 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: -20, max: 20 }),
        (initial, index, value) => {
          const target = { items: [...initial] };
          setValueAtPath(target, `items.${index}`, value, WRITE);

          expect(target.items[index]).toBe(value);
          expect(target.items.length).toBe(Math.max(initial.length, index + 1));
          for (let i = 0; i < initial.length; i++) {
            if (i !== index) expect(target.items[i]).toBe(initial[i]);
          }
          // Every fabricated slot is an explicit null, never a hole.
          for (let i = 0; i < target.items.length; i++) {
            expect(Object.hasOwn(target.items, String(i))).toBe(true);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("unset on an array index nulls the slot and keeps the length", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -20, max: 20 }), { minLength: 1, maxLength: 6 }),
        fc.nat(),
        (initial, offset) => {
          const index = offset % initial.length;
          const target = { items: [...initial] };
          unsetValueAtPath(target, `items.${index}`);

          expect(target.items.length).toBe(initial.length);
          expect(target.items[index]).toBeNull();
          for (let i = 0; i < initial.length; i++) {
            if (i !== index) expect(target.items[i]).toBe(initial[i]);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("unset on an object key removes the key entirely", () => {
    fc.assert(
      fc.property(pathArbitrary, fc.integer(), (path, value) => {
        const target: Record<string, unknown> = {};
        setValueAtPath(target, path, value, WRITE);
        unsetValueAtPath(target, path);
        expect(hasValueAtPath(target, path)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("rejects stepping into an array through a non-index segment", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 4 })
          .filter((s) => !/^\d+$/u.test(s) && !s.includes(".")),
        fc.integer(),
        (segment, value) => {
          const target = { items: [1, 2, 3] };
          expect(() => setValueAtPath(target, `items.${segment}`, value, WRITE)).toThrow(TypeError);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects creating a field inside a scalar", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.string({ maxLength: 3 }), fc.boolean()),
        segmentArbitrary,
        fc.integer(),
        (scalar, leaf, value) => {
          const target: Record<string, unknown> = { a: scalar };
          expect(() => setValueAtPath(target, `a.${leaf}`, value, WRITE)).toThrow(TypeError);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// `Path<T>` keeps `__proto__` out of *typed* call sites, but mill's runtime
// takes whatever string it is handed — and an update document that crossed a
// network boundary is just data. These pin what mill does with the segments
// that have meaning to the JS object model.
describe("path segments with meaning to the JS object model", () => {
  const OBJECT_PROTOTYPE_KEYS = ["polluted", "pA", "pB"] as const;

  afterEach(() => {
    // A leak here would corrupt every later test in the process, so fail loudly
    // rather than letting it ride.
    for (const key of OBJECT_PROTOTYPE_KEYS) {
      expect(({} as Record<string, unknown>)[key]).toBeUndefined();
    }
  });

  it("rejects `__proto__` anywhere in a path rather than writing through it", () => {
    fc.assert(
      fc.property(
        fc.array(segmentArbitrary, { maxLength: 2 }),
        fc.array(segmentArbitrary, { maxLength: 2 }),
        fc.integer({ min: 1, max: 1000 }),
        (before, after, value) => {
          const path = [...before, "__proto__", ...after].join(".");
          const store: Record<string, unknown> = { a: 1 };

          expect(() => update(store, {}, { $set: { [path]: value } } as never)).toThrow(
            /__proto__/u,
          );
          expect(Object.getPrototypeOf(store)).toBe(Object.prototype);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects `__proto__` for reads and deletes too, not just writes", () => {
    fc.assert(
      fc.property(fc.array(segmentArbitrary, { maxLength: 2 }), (before) => {
        const path = [...before, "__proto__"].join(".");
        const target = { a: { b: 1 } };

        expect(() => getValueAtPath(target, path)).toThrow(/__proto__/u);
        expect(() => hasValueAtPath(target, path)).toThrow(/__proto__/u);
        expect(() => deleteValueAtPath(target, path)).toThrow(/__proto__/u);
        expect(() => setValueAtPath(target, path, 1, WRITE)).toThrow(/__proto__/u);
      }),
      { numRuns: 100 },
    );
  });

  it("stops at `constructor` and other inherited functions, which are not containers", () => {
    // No special case needed for these: every inherited member other than
    // `__proto__` is a function, and `isContainer` already refuses to step into
    // one. This pins that the general guard keeps covering them.
    fc.assert(
      fc.property(
        fc.constantFrom("constructor", "toString", "valueOf", "hasOwnProperty"),
        fc.integer({ min: 1, max: 1000 }),
        (segment, value) => {
          const store: Record<string, unknown> = { a: 1 };

          expect(() => update(store, {}, { $set: { [`${segment}.pA`]: value } } as never)).toThrow(
            TypeError,
          );
          expect(getValueAtPath(store, `${segment}.pA`)).toBeUndefined();
          expect(hasValueAtPath(store, `${segment}.pA`)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
