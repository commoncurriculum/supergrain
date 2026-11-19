/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: `for…of` allocates an iterator per loop, as in
 * the rest of the list engine.
 */
import type { Caught } from "../rethrowing-computed";

import { catchUp, followArray, type ArrayLog, type LogReader, type Splice } from "../array-log";
import { trackArrayItems } from "../array-methods";
import { unwrap } from "../core";
import { wrap } from "../read";
import { forEachItem } from "./for-each-item";
import {
  createRow,
  createRowBlocks,
  type BlockGroup,
  type Row,
  type RowResult,
} from "./row-blocks";

export interface Structure<T, O, K> {
  /** Valid only until the next read, which may change it in place. */
  readonly list: ReadonlyArray<Row<T, O, K>>;
  readonly removed: ReadonlyArray<Row<T, O, K>>;
  /** Valid only until the next read, which may change it in place. */
  readonly blockGroups: ReadonlyArray<BlockGroup<T, O, K>>;
  /** When true, anything kept in `row.order` order must be re-sorted. */
  readonly reordered: boolean;
}

export function createSourceRows<T extends object, O, K>(
  source: () => Iterable<T>,
  resultOf: (item: T) => () => Caught<RowResult<O, K>>,
) {
  const rows = new Map<object, Row<T, O, K>>();
  // A row that left may come back as a different Row object.
  const isLive = (row: Row<T, O, K>): boolean => rows.get(row.raw) === row;
  const place = createRowBlocks<T, O, K>(isLive);
  // Set while labels may be half-changed (a walk threw, or splices were abandoned).
  let labelsInDoubt = false;
  let followed: { raw: ReadonlyArray<unknown>; log: ArrayLog; reader: LogReader } | null = null;
  let mirror: Array<Row<T, O, K>> = [];

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
      // The old reader, no longer held, lets its log be collected.
      const reader: LogReader = { position: -1 };
      followed = { raw, log: followArray(raw, reader), reader };
    }
    const { log, reader } = followed;
    // If the walk throws, walk again next time.
    reader.position = -1;
    // Raw walk: trackArrayItems above already covers every change.
    let seen = 0;
    const structure = walk((fn) => {
      raw.forEach((item: unknown) => {
        seen++;
        fn(wrap(item) as T);
      });
    });
    mirror = [...structure.list];
    // The mirror can't follow holes or duplicate rows: those walk every time.
    if (seen === raw.length && structure.list.length === seen) catchUp(raw, log, reader);
    return structure;
  }

  function splicesSince(log: ArrayLog, position: number): ReadonlyArray<Splice> | undefined {
    if (position < log.base) return undefined;
    const splices = log.entries.slice(position - log.base);
    for (let s = 0; s < splices.length; s++) {
      const splice = splices[s]!;
      if (splice === null) return undefined;
      const { added } = splice;
      for (let i = 0; i < added.length; i++) {
        const item = added[i];
        if (typeof item !== "object" || item === null) return undefined;
      }
    }
    return splices as ReadonlyArray<Splice>;
  }

  // Must not delete from `rows` until the splices are known to apply: a
  // give-up (undefined) falls back to a walk that relies on `rows`.
  function applySplices(splices: ReadonlyArray<Splice>): Structure<T, O, K> | undefined {
    const touched: Array<Row<T, O, K>> = [];
    const unplaced: Array<Row<T, O, K>> = [];
    let reordered = labelsInDoubt;
    labelsInDoubt = true;
    for (let s = 0; s < splices.length; s++) {
      const { index, removed: out, added } = splices[s]!;
      for (let i = 0; i < out.length; i++) {
        const row = rows.get(unwrap(out[i]) as object)!;
        row.count--;
        touched.push(row);
      }
      const rowsIn = new Array<Row<T, O, K>>(added.length); // eslint-disable-line unicorn/no-new-array -- every slot is filled below
      for (let i = 0; i < added.length; i++) {
        const raw = unwrap(added[i]) as object;
        let row = rows.get(raw);
        if (row === undefined) {
          const wrapped = wrap(raw) as T;
          row = createRow(wrapped, raw, resultOf(wrapped));
          rows.set(raw, row);
          unplaced.push(row);
        } else {
          reordered = true;
        }
        row.count++;
        touched.push(row);
        rowsIn[i] = row;
      }
      replaceRange(mirror, index, out.length, rowsIn);
      labelRange(mirror, index, rowsIn.length);
    }
    // Only after all splices: a two-write swap holds a row twice in between.
    for (let i = 0; i < touched.length; i++) if (touched[i]!.count > 1) return undefined;
    labelsInDoubt = false;

    const removed: Array<Row<T, O, K>> = [];
    for (let i = 0; i < touched.length; i++) {
      const row = touched[i]!;
      if (row.count === 0 && isLive(row)) {
        rows.delete(row.raw);
        removed.push(row);
      }
    }
    const placed: Array<Row<T, O, K>> = [];
    for (let i = 0; i < unplaced.length; i++) if (isLive(unplaced[i]!)) placed.push(unplaced[i]!);
    return { list: mirror, removed, blockGroups: place(mirror, placed, removed), reordered };
  }

  function walk(each: (fn: (item: T) => void) => void): Structure<T, O, K> {
    for (const row of rows.values()) row.count = 0;
    const list: Array<Row<T, O, K>> = [];
    const unplaced: Array<Row<T, O, K>> = [];
    let reordered = labelsInDoubt;
    labelsInDoubt = true;
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
        return;
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
    return { list, removed, blockGroups: place(list, unplaced, removed), reordered };
  }

  return read;
}

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
  // Float labels: the gap may be too small to split.
  if (low + step > low && (after === undefined || low + count * step < after)) {
    for (let i = 0; i < count; i++) list[start + i]!.order = low + (i + 1) * step;
    return;
  }
  for (let i = 0; i < list.length; i++) list[i]!.order = i;
}

// Spreading a large `items` into splice would overflow the call stack.
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
