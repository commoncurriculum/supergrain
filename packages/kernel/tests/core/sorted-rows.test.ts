import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createSortedRows, type SortedRows } from "../../src/query/sorted-rows";

/** The rows from `start` up to `end`, copied out. */
function window<R>(sorted: SortedRows<R>, start: number, end: number): Array<R> {
  const rows: Array<R> = [];
  sorted.copy(start, end, rows);
  return rows;
}

interface Row {
  key: number;
  seq: number;
}

const byKey = (a: Row, b: Row) => a.key - b.key || a.seq - b.seq;

describe("sorted rows", () => {
  it("keeps rows in order through inserts and removes, and copies any window", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(50), { maxLength: 400 }),
        fc.array(fc.nat(1000), { maxLength: 300 }),
        fc.nat(450),
        fc.nat(450),
        (keys, removals, start, length) => {
          const sorted = createSortedRows(byKey);
          const model: Row[] = [];
          keys.forEach((key, seq) => {
            const row = { key, seq };
            sorted.insert(row);
            model.push(row);
          });
          for (const pick of removals) {
            if (model.length === 0) break;
            const [row] = model.splice(pick % model.length, 1);
            sorted.remove(row!);
          }
          model.sort(byKey);
          expect(sorted.size).toBe(model.length);
          expect(window(sorted, 0, Infinity)).toEqual(model);
          expect(window(sorted, start, start + length)).toEqual(model.slice(start, start + length));
        },
      ),
    );
  });

  it("splits a chunk that grows too long", () => {
    const sorted = createSortedRows(byKey);
    const rows = Array.from({ length: 1000 }, (_, seq) => ({ key: (seq * 7919) % 1000, seq }));
    for (const row of rows) sorted.insert(row);
    expect(window(sorted, 0, Infinity)).toEqual([...rows].sort(byKey));
    expect(window(sorted, 500, 503).map((row) => row.key)).toEqual([500, 501, 502]);
  });

  it("starts from sorted rows on reset", () => {
    const sorted = createSortedRows(byKey);
    const rows = Array.from({ length: 300 }, (_, seq) => ({ key: seq, seq }));
    sorted.reset(rows);
    sorted.insert({ key: 150.5, seq: 300 });
    expect(window(sorted, 149, 153).map((row) => row.key)).toEqual([149, 150, 150.5, 151]);
  });

  it("still removes a row whose key changed after it was inserted", () => {
    const sorted = createSortedRows(byKey);
    const rows = Array.from({ length: 200 }, (_, seq) => ({ key: seq, seq }));
    sorted.reset(rows);
    rows[10]!.key = 190.5; // filed under 10, now compares as 190.5
    sorted.remove(rows[10]!);
    expect(sorted.size).toBe(199);
    expect(window(sorted, 0, Infinity)).not.toContain(rows[10]);
    // Removing a row that isn't there changes nothing.
    sorted.remove({ key: 5, seq: -1 });
    expect(sorted.size).toBe(199);
  });
});
