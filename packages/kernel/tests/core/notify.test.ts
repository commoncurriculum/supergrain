import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { $TRACK, batch, createReactive, effect, unwrap } from "../../src";

/**
 * The notify contract, checked over every kind of write and every kind of
 * reader: a reader whose result changed must rerun. (Rerunning when nothing
 * changed is allowed; it costs time, not correctness.)
 *
 * Each reader returns what it saw as a list of raw values, so "changed" is
 * judged by identity, the way the store judges a write.
 */

type Item = { id: number } | number | undefined;
type Reader = (list: Array<Item>) => ReadonlyArray<unknown>;

const raw = (value: unknown): unknown => unwrap(value);

const ARRAY_READERS: Record<string, Reader> = {
  "an index": (list) => [0, 1, 2, 5].map((i) => raw(list[i])),
  length: (list) => [list.length],
  "own keys": (list) => Object.keys(list),
  "`in`": (list) => [0, 1, 2, 5].map((i) => i in list),
  forEach: (list) => {
    const seen: Array<unknown> = [];
    list.forEach((item, i) => seen.push(i, raw(item)));
    return seen;
  },
  map: (list) => list.map(raw),
  "for...of": (list) => [...list].map(raw),
  // `For` reads `$TRACK` for the structure, then the raw array.
  $TRACK: (list) => {
    void (list as unknown as Record<symbol, unknown>)[$TRACK];
    const items = unwrap(list);
    return [items.length, ...Object.keys(items)];
  },
};

type Write =
  | { kind: "set"; index: number; value: number }
  | { kind: "length"; value: number }
  | { kind: "delete"; index: number }
  // A key that isn't an index: a plain property on the array.
  | { kind: "setProp" | "deleteProp"; key: "extra" | "-1" | "1.5" }
  | { kind: "push" | "unshift"; count: number }
  | { kind: "pop" | "shift" | "reverse" | "sort" }
  | { kind: "splice"; start: number; remove: number; add: number }
  | { kind: "fill"; value: number; start: number; end: number }
  | { kind: "copyWithin"; target: number; start: number; end: number };

let nextId = 100;
const newItem = (): Item => ({ id: nextId++ });

function apply(list: Array<Item>, write: Write): void {
  switch (write.kind) {
    case "set":
      list[write.index] = write.value < 0 ? newItem() : list[write.value];
      break;
    case "length":
      list.length = write.value;
      break;
    case "delete":
      delete list[write.index];
      break;
    case "setProp":
      (list as unknown as Record<string, unknown>)[write.key] = newItem();
      break;
    case "deleteProp":
      delete (list as unknown as Record<string, unknown>)[write.key];
      break;
    case "push":
    case "unshift":
      list[write.kind](...Array.from({ length: write.count }, newItem));
      break;
    case "pop":
    case "shift":
    case "reverse":
      list[write.kind]();
      break;
    case "sort":
      list.sort((a, b) => (raw(b) as { id: number })?.id - (raw(a) as { id: number })?.id || 0);
      break;
    case "splice":
      list.splice(write.start, write.remove, ...Array.from({ length: write.add }, newItem));
      break;
    case "fill":
      list.fill(newItem(), write.start, write.end);
      break;
    case "copyWithin":
      list.copyWithin(write.target, write.start, write.end);
      break;
  }
}

const small = fc.nat({ max: 6 });
const write: fc.Arbitrary<Write> = fc.oneof(
  fc.record({
    kind: fc.constant("set" as const),
    index: small,
    value: fc.integer({ min: -1, max: 5 }),
  }),
  fc.record({ kind: fc.constant("length" as const), value: small }),
  fc.record({ kind: fc.constant("delete" as const), index: small }),
  fc.record({
    kind: fc.constantFrom("setProp" as const, "deleteProp" as const),
    key: fc.constantFrom("extra" as const, "-1" as const, "1.5" as const),
  }),
  fc.record({
    kind: fc.constantFrom("push" as const, "unshift" as const),
    count: fc.nat({ max: 3 }),
  }),
  fc.record({
    kind: fc.constantFrom("pop" as const, "shift" as const, "reverse" as const, "sort" as const),
  }),
  fc.record({
    kind: fc.constant("splice" as const),
    start: small,
    remove: small,
    add: fc.nat({ max: 3 }),
  }),
  fc.record({ kind: fc.constant("fill" as const), value: small, start: small, end: small }),
  fc.record({ kind: fc.constant("copyWithin" as const), target: small, start: small, end: small }),
);

function same(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

describe("notify contract: every reader of an array reruns when what it read changed", () => {
  for (const [name, read] of Object.entries(ARRAY_READERS)) {
    it(`reader: ${name}`, () => {
      fc.assert(
        fc.property(
          fc.array(fc.nat({ max: 4 }), { maxLength: 5 }),
          fc.array(write, { minLength: 1, maxLength: 3 }),
          fc.boolean(),
          (start, writes, batched) => {
            const store = createReactive({ list: start.map(() => newItem()) });
            let seen: ReadonlyArray<unknown> = [];
            let runs = 0;
            const stop = effect(() => {
              seen = read(store.list);
              runs++;
            });
            const before = seen;
            const run = () => {
              for (const w of writes) apply(store.list, w);
            };
            if (batched) batch(run);
            else run();
            const after = read(store.list);
            stop();
            if (!same(before, after)) {
              expect({ writes, saw: seen }).toEqual({ writes, saw: after });
              expect(runs).toBeGreaterThan(1);
            }
          },
        ),
        { numRuns: 400 },
      );
    });
  }
});

describe("an array key past the largest index", () => {
  // 2 ** 32 - 1 and up name ordinary properties, not elements: writing one
  // leaves `length` alone, so it must notify like an object's field.
  for (const key of ["4294967295", "4294967296"]) {
    it(`notifies a reader of list[${key}] on a write and a delete`, () => {
      const store = createReactive({ list: [1, 2] });
      const list = store.list as unknown as Record<string, unknown>;
      const seen: Array<unknown> = [];
      const stop = effect(() => {
        seen.push(list[key]);
      });
      list[key] = "x";
      delete list[key];
      stop();
      // An extra rerun is allowed; a missed one is not.
      expect(seen.filter((value, i) => i === 0 || value !== seen[i - 1])).toEqual([
        undefined,
        "x",
        undefined,
      ]);
      expect(unwrap(store.list).length).toBe(2);
    });
  }
});

type ObjectWrite = { kind: "set"; key: string; value: number } | { kind: "delete"; key: string };

const KEYS = ["a", "b", "c"];
const OBJECT_READERS: Record<string, (doc: Record<string, unknown>) => ReadonlyArray<unknown>> = {
  "a key": (doc) => KEYS.map((key) => raw(doc[key])),
  "own keys": (doc) => Object.keys(doc),
  "`in`": (doc) => KEYS.map((key) => key in doc),
  $TRACK: (doc) => {
    void (doc as Record<symbol, unknown>)[$TRACK];
    return Object.keys(unwrap(doc));
  },
};

describe("notify contract: every reader of an object reruns when what it read changed", () => {
  const key = fc.constantFrom(...KEYS);
  const objectWrite: fc.Arbitrary<ObjectWrite> = fc.oneof(
    fc.record({ kind: fc.constant("set" as const), key, value: fc.integer({ min: -1, max: 2 }) }),
    fc.record({ kind: fc.constant("delete" as const), key }),
  );
  for (const [name, read] of Object.entries(OBJECT_READERS)) {
    it(`reader: ${name}`, () => {
      fc.assert(
        fc.property(
          fc.subarray(KEYS),
          fc.array(objectWrite, { minLength: 1, maxLength: 3 }),
          fc.boolean(),
          (start, writes, batched) => {
            const shared = newItem();
            const store = createReactive({
              doc: Object.fromEntries(start.map((k) => [k, newItem()])) as Record<string, unknown>,
            });
            let runs = 0;
            const stop = effect(() => {
              read(store.doc);
              runs++;
            });
            const before = read(store.doc);
            const run = () => {
              for (const w of writes) {
                if (w.kind === "delete") delete store.doc[w.key];
                else store.doc[w.key] = w.value < 0 ? newItem() : w.value === 0 ? shared : w.value;
              }
            };
            if (batched) batch(run);
            else run();
            const after = read(store.doc);
            stop();
            if (!same(before, after)) expect(runs).toBeGreaterThan(1);
          },
        ),
        { numRuns: 300 },
      );
    });
  }
});
