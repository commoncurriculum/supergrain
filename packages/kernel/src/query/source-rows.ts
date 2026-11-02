import type { Caught } from "../rethrowing-computed";

import { catchUp, followArray, type ArrayLog, type LogReader, type Splice } from "../array-log";
import { trackArrayItems } from "../array-methods";
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
  /** Valid only until the next read, which may change it in place. */
  readonly groups: ReadonlyArray<Group<T, O, K>>;
  /**
   * Whether rows that were already in the source changed order among
   * themselves (a sort, or a row moved). Anything kept in `row.order` order
   * must then be sorted again; otherwise new labels keep the old order.
   */
  readonly reordered: boolean;
}

/**
 * Reads the source's structure: its rows in order, made on first sight and
 * kept by raw object.
 *
 * Every row counts how many times the source holds it, and a row whose count
 * drops to zero has left. A walk recounts every row; when the source is a
 * store array, the list instead follows it through the array's log
 * (`array-log.ts`): `mirror` is its rows in order as of its reader's log
 * position, so a change costs the splices since, not a walk.
 */
export function createSourceRows<T extends object, O, K>(
  source: () => Iterable<T>,
  resultOf: (item: T) => () => Caught<RowResult<O, K>>,
) {
  const rows = new Map<object, Row<T, O, K>>();
  /** Whether `row` is still in the source (a row that left may come back as a new one). */
  const isLive = (row: Row<T, O, K>): boolean => rows.get(row.raw) === row;
  const place = createRowBlocks<T, O, K>(isLive);
  /**
   * Set while labels may be half-changed (a walk threw, or splices were
   * labelled and then given up on): the next structure reports `reordered`.
   */
  let labelsInDoubt = false;
  /** The store array being followed through its log, and the list's place in it. */
  let followed: { raw: ReadonlyArray<unknown>; log: ArrayLog; reader: LogReader } | null = null;
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
    if (followed?.raw === raw) {
      const { log, reader } = followed;
      const splices = splicesSince(log, reader.position);
      const structure = splices && applySplices(splices);
      if (structure) {
        catchUp(raw, log, reader);
        return structure;
      }
    } else {
      // A new reader per array: the old one, no longer held, lets its log go.
      const reader: LogReader = { position: -1 };
      followed = { raw, log: followArray(raw, reader), reader };
    }
    const { log, reader } = followed;
    // Until the walk succeeds, the mirror is stale: walk again next time.
    reader.position = -1;
    // Walk the raw array: no proxy reads, and the three signals above
    // already cover every change to it.
    let seen = 0;
    const structure = walk((fn) => {
      raw.forEach((item: unknown) => {
        seen++;
        fn(wrap(item) as T);
      });
    });
    mirror = [...structure.list];
    // The mirror can't follow an array with holes, or one that holds a row
    // twice (the list counts it once, at its first position): walk those
    // every time.
    if (seen === raw.length && structure.list.length === seen) catchUp(raw, log, reader);
    return structure;
  }

  /** The splices since `position`, or `undefined` if the log can't say. */
  function splicesSince(log: ArrayLog, position: number): ReadonlyArray<Splice> | undefined {
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
   *
   * In two steps, so a give-up changes nothing the walk keeps: first replay
   * the splices on the counts and the mirror (the walk rebuilds both), then,
   * only once the splices are known to apply, take out the rows that left.
   */
  function applySplices(splices: ReadonlyArray<Splice>): Structure<T, O, K> | undefined {
    const touched: Array<Row<T, O, K>> = [];
    const unplaced: Array<Row<T, O, K>> = [];
    let reordered = labelsInDoubt;
    labelsInDoubt = true;
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
          row = createRow(wrapped, raw, resultOf(wrapped));
          rows.set(raw, row);
          unplaced.push(row);
        } else {
          reordered = true; // A row already here, moved (or held twice).
        }
        row.count++;
        touched.push(row);
        return row;
      });
      replaceRange(mirror, index, out.length, rowsIn);
      labelRange(mirror, index, rowsIn.length);
    }
    if (touched.some((row) => row.count > 1)) return undefined;
    labelsInDoubt = false;

    const removed: Array<Row<T, O, K>> = [];
    for (const row of touched) {
      if (row.count === 0 && isLive(row)) {
        rows.delete(row.raw);
        removed.push(row);
      }
    }
    // A row added and removed again within these splices was never placed.
    const placed = unplaced.filter(isLive);
    return { list: mirror, removed, groups: place(mirror, placed, removed), reordered };
  }

  /** Walk the items: every row in order, once each. Rows not found have left. */
  function walk(each: (fn: (item: T) => void) => void): Structure<T, O, K> {
    for (const row of rows.values()) row.count = 0;
    const list: Array<Row<T, O, K>> = [];
    const unplaced: Array<Row<T, O, K>> = [];
    let reordered = labelsInDoubt;
    labelsInDoubt = true;
    /** The old label of the last row seen that was already here. */
    let last = -Infinity;
    each((item) => {
      if (typeof item !== "object" || item === null) {
        throw new TypeError("@supergrain/kernel: query rows must be objects.");
      }
      const raw = unwrap(item);
      let row = rows.get(raw);
      if (row === undefined) {
        row = createRow(item, raw, resultOf(item));
        rows.set(raw, row);
      } else if (row.count > 0) {
        return; // The same object twice counts once.
      } else {
        if (row.order < last) reordered = true;
        last = row.order;
      }
      row.count = 1;
      row.order = list.length;
      list.push(row);
      if (row.block === -1) unplaced.push(row);
    });
    labelsInDoubt = false;
    const removed: Array<Row<T, O, K>> = [];
    if (list.length < rows.size) {
      for (const [raw, row] of rows) {
        if (row.count === 0) {
          rows.delete(raw);
          removed.push(row);
        }
      }
    }
    return { list, removed, groups: place(list, unplaced, removed), reordered };
  }

  return read;
}

/**
 * Label the `count` rows just put in `list` at `start` so that labels still
 * increase along the list: between their neighbours' labels, or past the end.
 * When the gap between neighbours is too small to split, label every row
 * again by its index, which keeps their order.
 */
function labelRange(list: ReadonlyArray<{ order: number }>, start: number, count: number): void {
  if (count === 0) return;
  const end = start + count;
  const before = start > 0 ? list[start - 1]!.order : undefined;
  const after = end < list.length ? list[end]!.order : undefined;
  if (before === undefined && after === undefined) {
    for (let i = start; i < end; i++) list[i]!.order = i;
    return;
  }
  const low = before ?? after! - count - 1;
  const step = after === undefined ? 1 : (after - low) / (count + 1);
  // The labels must land strictly between `low` and `after`.
  if (low + step > low && (after === undefined || low + count * step < after)) {
    for (let i = 0; i < count; i++) list[start + i]!.order = low + (i + 1) * step;
    return;
  }
  for (let i = 0; i < list.length; i++) list[i]!.order = i;
}

/**
 * `array.splice(start, deleteCount, ...items)`, without passing `items` as
 * arguments: a splice that adds a whole large array (a `reverse` or `sort`)
 * would overflow the call stack.
 */
function replaceRange<R>(
  array: Array<R>,
  start: number,
  deleteCount: number,
  items: ReadonlyArray<R>,
): void {
  if (items.length <= 1024) {
    array.splice(start, deleteCount, ...items);
    return;
  }
  const tail = array.slice(start + deleteCount);
  array.length = start;
  for (const part of [items, tail]) for (const item of part) array.push(item);
}
