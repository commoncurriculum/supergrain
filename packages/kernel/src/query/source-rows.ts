import type { Caught } from "../rethrowing-computed";

import { arrayLog, logEnd, trackArrayItems, type ArrayLog, type Splice } from "../array-log";
import { unwrap } from "../core";
import { wrap } from "../read";
import { forEachItem } from "./for-each-item";
import { createRow, createRowBlocks, type Group, type Row, type RowResult } from "./row-blocks";

/** The source's rows in order (once each), the rows that left it, and the groups to read. */
export interface Structure<T, O, K> {
  /**
   * Valid only until the next read: when following an array's log, this is
   * the mirror itself, which the next splices change in place (copying it
   * would cost a walk per change).
   */
  readonly list: ReadonlyArray<Row<T, O, K>>;
  readonly removed: ReadonlyArray<Row<T, O, K>>;
  readonly groups: ReadonlyArray<Group<T, O, K>>;
}

/**
 * Reads the source's structure: its rows in order, made on first sight and
 * kept by raw object.
 *
 * Every row counts how many times the source holds it, and a row whose count
 * drops to zero has left. A walk recounts every row; when the source is a
 * store array, the list instead follows it through the array's log
 * (`array-log.ts`): `mirror` is its rows in order as of log position
 * `position`, so a change costs the splices since, not a walk.
 */
export function createSourceRows<T extends object, O, K>(
  source: () => Iterable<T>,
  resultOf: (item: T) => () => Caught<RowResult<O, K>>,
) {
  const rows = new Map<object, Row<T, O, K>>();
  /** Whether `row` is still in the source (a row that left may come back as a new one). */
  const isLive = (row: Row<T, O, K>): boolean => rows.get(row.raw) === row;
  const place = createRowBlocks<T, O, K>(isLive);
  let nextSeq = 0;
  let followed: ReadonlyArray<unknown> | null = null;
  let position = -1;
  let mirror: Array<Row<T, O, K>> = [];

  /** Read the source's structure. Tracked. */
  function read(): Structure<T, O, K> {
    const items = source();
    const raw = unwrap(items);
    if (raw === items || !Array.isArray(raw)) {
      followed = null;
      return walk((fn) => forEachItem(items, fn));
    }
    trackArrayItems(raw);
    const log = arrayLog(raw);
    const splices = raw === followed ? splicesSince(log) : undefined;
    if (splices) {
      const structure = applySplices(splices);
      if (structure) {
        position = logEnd(log);
        return structure;
      }
    }
    // Walk the raw array: no proxy reads, and the three signals above
    // already cover every change to it.
    followed = null;
    let seen = 0;
    const structure = walk((fn) => {
      raw.forEach((item: unknown) => {
        seen++;
        fn(wrap(item) as T);
      });
    });
    followed = raw;
    mirror = [...structure.list];
    // The mirror can't follow an array with holes, or one that holds a row
    // twice (the list counts it once, at its first position): walk those
    // every time.
    position = seen === raw.length && structure.list.length === seen ? logEnd(log) : -1;
    return structure;
  }

  /** The splices since `position`, or `undefined` if the log can't say. */
  function splicesSince(log: ArrayLog): ReadonlyArray<Splice> | undefined {
    if (position < log.base) return undefined;
    const splices = log.entries.slice(position - log.base);
    for (const splice of splices) {
      // A hole, or an item that isn't an object: the walk handles both.
      if (splice === null) return undefined;
      for (const item of splice.added)
        if (typeof item !== "object" || item === null) return undefined;
    }
    return splices as ReadonlyArray<Splice>;
  }

  /**
   * Apply `splices` to the mirror. Returns `undefined`, for the caller to
   * walk instead, if the source now holds a row twice.
   */
  function applySplices(splices: ReadonlyArray<Splice>): Structure<T, O, K> | undefined {
    const touched: Array<Row<T, O, K>> = [];
    const unplaced: Array<Row<T, O, K>> = [];
    for (const { index, removed: out, added } of splices) {
      for (const item of out) {
        const row = rows.get(unwrap(item) as object)!;
        row.count--;
        touched.push(row);
      }
      const rowsIn = added.map((item) => {
        const raw = unwrap(item) as object;
        let row = rows.get(raw);
        if (row === undefined) {
          const wrapped = wrap(raw) as T;
          row = createRow(wrapped, raw, nextSeq++, resultOf(wrapped));
          rows.set(raw, row);
          unplaced.push(row);
        }
        row.count++;
        touched.push(row);
        return row;
      });
      mirror.splice(index, out.length, ...rowsIn);
    }
    const removed: Array<Row<T, O, K>> = [];
    for (const row of touched) {
      if (row.count > 1) return undefined;
      if (row.count === 0 && isLive(row)) {
        rows.delete(row.raw);
        removed.push(row);
      }
    }
    // A row added and removed again within these splices was never placed.
    const placed = unplaced.filter(isLive);
    return { list: mirror, removed, groups: place(mirror, placed, removed) };
  }

  /** Walk the items: every row in order, once each. Rows not found have left. */
  function walk(each: (fn: (item: T) => void) => void): Structure<T, O, K> {
    for (const row of rows.values()) row.count = 0;
    const list: Array<Row<T, O, K>> = [];
    const unplaced: Array<Row<T, O, K>> = [];
    each((item) => {
      if (typeof item !== "object" || item === null) {
        throw new TypeError("@supergrain/kernel: query rows must be objects.");
      }
      const raw = unwrap(item);
      let row = rows.get(raw);
      if (row === undefined) {
        row = createRow(item, raw, nextSeq++, resultOf(item));
        rows.set(raw, row);
      } else if (row.count > 0) {
        return; // The same object twice counts once.
      }
      row.count = 1;
      list.push(row);
      if (row.block === -1) unplaced.push(row);
    });
    const removed: Array<Row<T, O, K>> = [];
    if (list.length < rows.size) {
      for (const [raw, row] of rows) {
        if (row.count === 0) {
          rows.delete(raw);
          removed.push(row);
        }
      }
    }
    return { list, removed, groups: place(list, unplaced, removed) };
  }

  return read;
}
