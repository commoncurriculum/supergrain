import { describe, expect, it } from "vitest";

import { createReactive, effect, unwrap } from "../../src";
import { followArray, logEnd } from "../../src/array-log";
import { spliceArray } from "../../src/sync-array";

const item = (id: number) => ({ id });

describe("spliceArray", () => {
  it("replaces only what lies between the common start and end, as one splice", () => {
    const items = [0, 1, 2, 3, 4].map(item);
    const store = createReactive({ list: [...items] });
    const raw = unwrap(store.list);
    const reader = { position: -1 };
    const log = followArray(raw, reader);
    reader.position = logEnd(log);
    const next = [items[0]!, item(9), item(8), items[3]!, items[4]!];
    spliceArray(store.list, raw.slice(), raw.length, next, next.length);
    expect(raw).toEqual(next);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({ index: 1, removed: [items[1], items[2]] });
  });

  it("stores raw items, never proxies", () => {
    const store = createReactive({ list: [item(0)], other: [item(1), item(2)] });
    const next = [...store.other];
    spliceArray(store.list, unwrap(store.list).slice(), 1, next, next.length);
    expect(unwrap(store.list)).toEqual([item(1), item(2)]);
    for (const value of unwrap(store.list)) expect(unwrap(value)).toBe(value);
  });

  it("adds more items than one call can spread", () => {
    const items = Array.from({ length: 3000 }, (_, i) => item(i));
    const store = createReactive({ list: [items[0]!, items[2999]!] });
    let lengths = 0;
    const stop = effect(() => {
      void store.list.length;
      lengths++;
    });
    spliceArray(store.list, unwrap(store.list).slice(), 2, items, items.length);
    stop();
    expect(unwrap(store.list)).toEqual(items);
    expect(lengths).toBeGreaterThan(1);
  });
});
