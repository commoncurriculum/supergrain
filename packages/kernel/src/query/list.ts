import { setActiveSub } from "alien-signals";

import { unwrap } from "../core";
import { rethrowingComputed } from "../rethrowing-computed";
import { createReactive } from "../store";
import { syncArray } from "../sync-array";

/**
 * What a row's steps produce: whether it's in the list, its output value, and
 * its sort key.
 */
export type RowOutcome<O, K> =
  | { readonly member: false }
  | { readonly member: true; readonly value: O; readonly key: K };

/** Options for {@link createList}, the engine under `computedList`. */
export interface ListOptions<S extends object, O, K> {
  /** The source items. Read reactively; only its structure should be read here. */
  source: () => Iterable<S>;
  /**
   * Run a row's steps. Runs inside the row's own computed, so it reruns only
   * when something it read changes. `previous` is the value it last returned,
   * so it can hand back the same object when nothing changed.
   */
  run: (item: S, previous: O | undefined) => RowOutcome<O, K>;
  /** Compare sort keys, or `undefined` to keep source order. */
  compare: ((a: K, b: K) => number) | undefined;
  /** Rows to skip from the start of the result. Read reactively. */
  offset: () => number;
  /** Most rows to return. Read reactively. */
  limit: () => number;
}

/** A row's latest outcome (member, value, sort key). A new object only when it changed. */
interface RowResult<O, K> {
  readonly member: boolean;
  readonly value: O | undefined;
  readonly key: K | undefined;
}

interface Row<T, O, K> {
  readonly item: T;
  /** Order of first appearance; breaks ties between equal keys. */
  readonly seq: number;
  readonly result: () => RowResult<O, K>;
  /** The result this row is filed under in the list. */
  applied: RowResult<O, K>;
  /** The last read that found this row in the source. */
  seenAt: number;
  /** The block this row belongs to, or -1 before it is placed in one. */
  block: number;
}

/** A row whose result changed since it was last filed, and its new result. */
type Change<T, O, K> = readonly [row: Row<T, O, K>, next: RowResult<O, K>];

/**
 * A group of rows with one computed over all their results. It reruns when
 * one of them changes, and returns the rows whose result differs from where
 * they are filed. The list reads one of these per block instead of one result
 * per row, so a change to one row costs about √N reads instead of N.
 *
 * Rows stay in their block when other rows come and go, so adding or removing
 * a row replaces only the blocks it touched. The others keep their changes.
 */
interface Block<T, O, K> {
  readonly rows: ReadonlyArray<Row<T, O, K>>;
  readonly changes: () => ReadonlyArray<Change<T, O, K>>;
  /** The changes last applied to the list. Set only after an update succeeds. */
  applied: ReadonlyArray<Change<T, O, K>> | undefined;
}

interface Structure<T, O, K> {
  readonly list: ReadonlyArray<Row<T, O, K>>;
  readonly removed: ReadonlyArray<Row<T, O, K>>;
  readonly blocks: ReadonlyArray<Block<T, O, K>>;
}

function createBlock<T, O, K>(rows: ReadonlyArray<Row<T, O, K>>): Block<T, O, K> {
  return {
    rows,
    applied: undefined,
    changes: rethrowingComputed(() => {
      const changes: Array<Change<T, O, K>> = [];
      for (const row of rows) {
        const result = row.result();
        if (result !== row.applied) changes.push([row, result]);
      }
      return changes;
    }),
  };
}

const OUTSIDE: RowResult<never, never> = Object.freeze({
  member: false,
  value: undefined,
  key: undefined,
});

/**
 * The engine under `computedList`: a list of source rows, each run through
 * its steps in its own computed, kept sorted and windowed, that updates
 * **one row at a time**.
 *
 * - each row's steps run in their own `computed`, so the kernel's field
 *   tracking reruns them for the changed row only;
 * - the list keeps the matching rows in a sorted array, and moves only the
 *   rows whose outcome changed, with a binary search;
 * - the result is one persistent reactive array synced in place (as in
 *   `stableComputed`), so only slots that changed notify.
 *
 * It is pull-based: nothing runs until the list is read, there are no
 * effects, and so there is nothing to dispose.
 *
 * To find the changed row without checking every row, rows are grouped into
 * blocks of about √N, each with a computed that finds which of its rows'
 * outcomes changed. A field edit costs about √N cached reads (two blocks'
 * worth), not N. Adding or removing rows in the source walks it once (no
 * steps run for rows it already knew), and replaces only the blocks those
 * rows were in. Without a sort, the result is refiltered in source order from
 * cached outcomes on each change.
 */
export function createList<T extends object, O, K>(
  options: ListOptions<T, O, K>,
): () => ReadonlyArray<O> {
  const { source, run, compare, offset: offsetOf, limit: limitOf } = options;

  // Rows by raw object. Each read stamps the rows it finds with `seenAt`, so
  // a row with an older stamp has left the source. (A stamp, rather than
  // moving rows between maps, stays correct when a read throws part-way.)
  const rows = new Map<object, Row<T, O, K>>();
  let reads = 0;
  // The matching rows by `(key, seq)`. `null` after a read threw part-way (a
  // a throwing step or `compare`), so the next read rebuilds it
  // from `rows` instead of trusting it: rows that left the source during the
  // failed read were never taken out of it.
  let sorted: Array<Row<T, O, K>> | null = [];
  let nextSeq = 0;
  const out = createReactive<Array<O>>([]) as Array<O>;

  const compareRows = (a: Row<T, O, K>, b: Row<T, O, K>): number =>
    compare!(a.applied.key as K, b.applied.key as K) || a.seq - b.seq;

  function createRow(item: T): Row<T, O, K> {
    return {
      item,
      seq: nextSeq++,
      applied: OUTSIDE,
      seenAt: 0,
      block: -1,
      result: rethrowingComputed((previous: RowResult<O, K> | undefined): RowResult<O, K> => {
        const outcome = run(item, previous?.value);
        if (!outcome.member) return OUTSIDE;
        // Hand back the previous object when nothing changed, so the list
        // isn't dirtied by edits that don't move this row.
        if (
          previous?.member &&
          previous.value === outcome.value &&
          (!compare || untracked(() => compare(previous.key as K, outcome.key)) === 0)
        ) {
          return previous;
        }
        return { member: true, value: outcome.value, key: outcome.key };
      }),
    };
  }

  // The source's rows in order, the rows that left it, and the blocks.
  // Recomputed only when the source's structure changes.
  let blocks: Array<Block<T, O, K>> = [];
  const structure = rethrowingComputed(readStructure);
  let current: Structure<T, O, K> | undefined = undefined;
  // Without a sort: the matching rows in source order.
  let matching: ReadonlyArray<Row<T, O, K>> = [];

  return rethrowingComputed((): ReadonlyArray<O> => {
    try {
      return update();
    } catch (error) {
      sorted = null;
      throw error;
    }
  });

  function update(): ReadonlyArray<O> {
    // Tracked: the source's structure, each block's changes, the window.
    const next = structure();
    const pending = next.blocks.map((block) => block.changes());
    const offset = Math.max(0, offsetOf());
    const limit = Math.max(0, limitOf());
    // Untracked: `compare` may read reactive values, and the list must not
    // subscribe to them or to its own output.
    untracked(() => {
      const changes: Array<Change<T, O, K>> = [];
      if (next !== current) {
        for (const row of next.removed) if (row.applied.member) changes.push([row, OUTSIDE]);
      }
      next.blocks.forEach((block, b) => {
        if (pending[b] === block.applied) return;
        // A failed update may have filed some of these already.
        for (const change of pending[b]!) if (change[0].applied !== change[1]) changes.push(change);
      });
      const ordered = compare ? applyChanges(changes) : filterChanges(next, changes);
      syncArray(
        out,
        ordered.slice(offset, offset + limit).map((row) => row.applied.value),
      );
    });
    // Nothing threw: record what the list now reflects.
    next.blocks.forEach((block, b) => (block.applied = pending[b]));
    current = next;
    return out;
  }

  /** Walk the source: its rows in order (once each), the rows that left, and the blocks. */
  function readStructure(): Structure<T, O, K> {
    const read = ++reads;
    const list: Array<Row<T, O, K>> = [];
    const unplaced: Array<Row<T, O, K>> = [];
    const removed: Array<Row<T, O, K>> = [];
    forEachItem(source(), (item) => {
      if (typeof item !== "object" || item === null) {
        throw new TypeError("@supergrain/kernel: query rows must be objects.");
      }
      const raw = unwrap(item);
      let row = rows.get(raw);
      if (row === undefined) {
        row = createRow(item);
        rows.set(raw, row);
      } else if (row.seenAt === read) {
        return; // The same object twice counts once.
      }
      row.seenAt = read;
      list.push(row);
      if (row.block === -1) unplaced.push(row);
    });
    if (list.length < rows.size) {
      for (const [raw, row] of rows) {
        if (row.seenAt !== read) {
          rows.delete(raw);
          removed.push(row);
        }
      }
    }
    // The walk succeeded, so it's safe to move rows between blocks now.
    placeRows(list, unplaced, removed, read);
    return { list, removed, blocks: [...blocks] };
  }

  /**
   * Take removed rows out of their blocks and put new rows in the last
   * block, or new ones. Only the blocks that changed are replaced. When
   * removals have left too many sparse blocks, regroup every row.
   */
  function placeRows(
    list: ReadonlyArray<Row<T, O, K>>,
    unplaced: ReadonlyArray<Row<T, O, K>>,
    removed: ReadonlyArray<Row<T, O, K>>,
    read: number,
  ): void {
    const size = Math.max(16, Math.ceil(Math.sqrt(list.length)));
    if (blocks.length + unplaced.length / size > 2 * Math.ceil(list.length / size) + 1) {
      blocks = [];
      for (let start = 0; start < list.length; start += size) {
        blocks.push(placeIn(blocks.length, list.slice(start, start + size)));
      }
      return;
    }
    const edited = new Map<number, Array<Row<T, O, K>>>();
    const rowsOf = (b: number): Array<Row<T, O, K>> => {
      let blockRows = edited.get(b);
      if (blockRows === undefined) {
        blockRows = b < blocks.length ? blocks[b]!.rows.filter((row) => row.seenAt === read) : [];
        edited.set(b, blockRows);
      }
      return blockRows;
    };
    for (const row of removed) if (row.block !== -1) rowsOf(row.block);
    let last = blocks.length - 1;
    for (const row of unplaced) {
      const lastSize = edited.get(last)?.length ?? blocks[last]?.rows.length ?? size;
      if (lastSize >= size) last++;
      rowsOf(last).push(row);
    }
    for (const [b, blockRows] of edited) blocks[b] = placeIn(b, blockRows);
  }

  function placeIn(b: number, blockRows: ReadonlyArray<Row<T, O, K>>): Block<T, O, K> {
    for (const row of blockRows) row.block = b;
    return createBlock(blockRows);
  }

  /** Without a sort: the matching rows in source order, refiltered only when something changed. */
  function filterChanges(
    next: Structure<T, O, K>,
    changes: ReadonlyArray<Change<T, O, K>>,
  ): ReadonlyArray<Row<T, O, K>> {
    for (const [row, result] of changes) row.applied = result;
    if (next !== current || changes.length > 0) {
      matching = next.list.filter((row) => row.applied.member);
    }
    return matching;
  }

  function applyChanges(changes: ReadonlyArray<Change<T, O, K>>): ReadonlyArray<Row<T, O, K>> {
    // When many rows moved at once (say a filter reads a shared value), sorting
    // from scratch is cheaper than moving each one.
    if (sorted === null || changes.length > 16 + sorted.length / 4) {
      for (const [row, next] of changes) row.applied = next;
      sorted = [...rows.values()].filter((row) => row.applied.member).sort(compareRows);
      return sorted;
    }
    for (const [row, next] of changes) {
      if (row.applied.member) sorted.splice(indexOf(sorted, row, compareRows), 1);
      row.applied = next;
      if (next.member) sorted.splice(insertionPoint(sorted, row, compareRows), 0, row);
    }
    return sorted;
  }
}

/** The first index in `sorted` whose item orders at or after `item`. */
function insertionPoint<R>(
  sorted: ReadonlyArray<R>,
  item: R,
  compare: (a: R, b: R) => number,
): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compare(sorted[mid]!, item) < 0) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Where `item` sits in `sorted`, by binary search. */
function indexOf<R>(sorted: ReadonlyArray<R>, item: R, compare: (a: R, b: R) => number): number {
  const i = insertionPoint(sorted, item, compare);
  // A miss only happens with an inconsistent `compare` or a key that mutated.
  return sorted[i] === item ? i : sorted.indexOf(item);
}

/** Run `fn` without subscribing the active computed to what it reads. */
function untracked<R>(fn: () => R): R {
  const prevSub = setActiveSub(undefined);
  try {
    return fn();
  } finally {
    setActiveSub(prevSub);
  }
}

export function toGetter(
  value: number | (() => number) | undefined,
  fallback: number,
): () => number {
  if (typeof value === "function") return value;
  const fixed = value ?? fallback;
  return () => fixed;
}

// A kernel array's `forEach` subscribes to its structure with three signals;
// `for...of` would subscribe to every index.
export function forEachItem<T>(source: Iterable<T>, fn: (item: T) => void): void {
  if (Array.isArray(source)) {
    (source as ReadonlyArray<T>).forEach((item) => fn(item));
  } else {
    for (const item of source) fn(item);
  }
}
