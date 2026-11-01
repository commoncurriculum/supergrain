import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createReactive, reconcile, unwrap } from "../../src";
import { arrayLog, logEnd, type ArrayLog } from "../../src/array-log";

interface Item {
  id: number;
}

const item = (id: number): Item => ({ id });

/**
 * Replay the log from `from` onto `start`. Returns `undefined` when the log
 * can't describe the changes (a hole, or a reader that fell behind), which is
 * when a reader walks the array instead.
 */
function replay(log: ArrayLog, from: number, start: ReadonlyArray<unknown>): unknown[] | undefined {
  if (from < log.base) return undefined;
  const result = [...start];
  for (const splice of log.entries.slice(from - log.base)) {
    if (splice === null) return undefined;
    result.splice(splice.index, splice.removed.length, ...splice.added);
  }
  return result.map((value) => unwrap(value));
}

/** The same items, by identity, in the same order. */
function expectSameItems(actual: unknown[] | undefined, items: Item[]): void {
  const raw = unwrap(items);
  expect(actual).toHaveLength(raw.length);
  actual!.forEach((value, i) => expect(value).toBe(unwrap(raw[i])));
}

function follow(items: Item[]) {
  const raw = unwrap(items);
  const log = arrayLog(raw);
  const from = logEnd(log);
  const start = [...raw];
  return { log, replayed: () => replay(log, from, start) };
}

describe("array log", () => {
  it("records nothing for arrays no reader asked about", () => {
    const store = createReactive({ items: [item(1)] });
    store.items.push(item(2));
    const log = arrayLog(unwrap(store.items));
    expect(log.entries).toEqual([]);
  });

  it("records each mutator as the smallest splice", () => {
    const store = createReactive({ items: [1, 2, 3, 4].map(item) });
    const { log, replayed } = follow(store.items);

    store.items.splice(1, 1);
    expect(log.entries.at(-1)).toMatchObject({ index: 1, removed: [{ id: 2 }], added: [] });
    store.items.push(item(5), item(6));
    store.items.pop();
    store.items.shift();
    store.items.unshift(item(7));
    store.items.reverse();
    store.items.sort((a, b) => a.id - b.id);
    store.items.copyWithin(0, 2);
    store.items.fill(item(8), 3);
    // Leading and trailing items that stay are left out of the splice.
    store.items.splice(0, 3, store.items[0]!, item(11), store.items[2]!);
    expect(log.entries.at(-1)).toMatchObject({ index: 1, removed: [{}], added: [{ id: 11 }] });
    expectSameItems(replayed(), store.items);
  });

  it("records index writes, appends and truncations", () => {
    const store = createReactive({ items: [1, 2, 3].map(item) });
    const { log, replayed } = follow(store.items);

    store.items[1] = item(9);
    store.items[3] = item(10);
    store.items[0] = store.items[0]!; // the same item: nothing to record
    store.items.length = 2;
    expect(log.entries).toHaveLength(3);
    expectSameItems(replayed(), store.items);
  });

  it("ignores writes to properties that aren't indices", () => {
    const store = createReactive({ items: [item(1)] });
    const { log } = follow(store.items);
    const items = store.items as unknown as Record<PropertyKey, unknown>;
    items[Symbol.for("tag")] = 1;
    items["label"] = "a";
    items["01"] = "b";
    expect(log.entries).toEqual([]);
  });

  it("follows reconcile", () => {
    const store = createReactive({ items: [1, 2, 3, 4].map(item) });
    const { replayed } = follow(store.items);
    reconcile(store.items, [4, 2, 5].map(item));
    expectSameItems(replayed(), store.items);
  });

  it("gives up on holes and on growing `length`", () => {
    for (const makeHole of [
      (items: Item[]) => delete items[1],
      (items: Item[]) => (items.length = 5),
      (items: Item[]) => (items[6] = item(6)),
    ]) {
      const store = createReactive({ items: [1, 2, 3].map(item) });
      const { replayed } = follow(store.items);
      makeHole(store.items);
      expect(replayed()).toBeUndefined();
    }
  });

  it("gives up on a write into a hole", () => {
    const sparse: Item[] = [item(1), item(2), item(3)];
    delete sparse[1];
    const store = createReactive({ items: sparse });
    const { replayed } = follow(store.items);
    store.items[1] = item(4);
    expect(replayed()).toBeUndefined();
  });

  it("keeps only recent entries, so a reader far behind walks", () => {
    const store = createReactive({ items: [item(0)] });
    const { log, replayed } = follow(store.items);
    for (let i = 1; i <= 300; i++) store.items.push(item(i));
    expect(log.base).toBeGreaterThan(0);
    expect(replayed()).toBeUndefined();
  });

  it("replays to the array after any sequence of writes", () => {
    const op = fc.oneof(
      fc.record({ type: fc.constant("push" as const), id: fc.nat(20) }),
      fc.record({ type: fc.constant("pop" as const) }),
      fc.record({ type: fc.constant("shift" as const) }),
      fc.record({ type: fc.constant("unshift" as const), id: fc.nat(20) }),
      fc.record({
        type: fc.constant("splice" as const),
        at: fc.integer({ min: -3, max: 8 }),
        count: fc.nat(3),
        ids: fc.array(fc.nat(20), { maxLength: 3 }),
      }),
      fc.record({ type: fc.constant("set" as const), at: fc.nat(8), id: fc.nat(20) }),
      fc.record({ type: fc.constant("truncate" as const), to: fc.nat(8) }),
      fc.record({ type: fc.constant("reverse" as const) }),
      fc.record({ type: fc.constant("sort" as const) }),
      fc.record({ type: fc.constant("reconcile" as const), ids: fc.array(fc.nat(10)) }),
    );
    fc.assert(
      fc.property(fc.array(fc.nat(20), { maxLength: 8 }), fc.array(op), (initial, ops) => {
        // A shared pool, so the same item can be moved, removed and come back.
        const pool = Array.from({ length: 21 }, (_, id) => item(id));
        const store = createReactive({ items: initial.map((id) => pool[id]!) });
        const { replayed } = follow(store.items);
        for (const step of ops) {
          const items = store.items;
          if (step.type === "push") items.push(pool[step.id]!);
          else if (step.type === "pop") items.pop();
          else if (step.type === "shift") items.shift();
          else if (step.type === "unshift") items.unshift(pool[step.id]!);
          else if (step.type === "splice")
            items.splice(step.at, step.count, ...step.ids.map((id) => pool[id]!));
          else if (step.type === "set") {
            if (step.at <= items.length) items[step.at] = pool[step.id]!;
          } else if (step.type === "truncate") {
            if (step.to <= items.length) items.length = step.to;
          } else if (step.type === "reverse") items.reverse();
          else if (step.type === "sort") items.sort((a, b) => a.id - b.id);
          else reconcile(store.items, step.ids.map(item));
          const result = replayed();
          if (result !== undefined) expectSameItems(result, store.items);
        }
      }),
    );
  });
});
