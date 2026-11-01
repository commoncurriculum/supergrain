import { computed, setActiveSub } from "alien-signals";

import { arrayLog, logEnd, trackArrayItems, type ArrayLog, type Splice } from "../array-log";
import { unwrap } from "../core";
import { readWholeObjects, wrap } from "../read";
import { rethrowingComputed } from "../rethrowing-computed";
import { createReactive } from "../store";
import { syncArray } from "../sync-array";
import { createSortedRows } from "./sorted-rows";

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
   * Runs, tracked, at the start of every update, before any row is read. The
   * query uses it to bring its lookups up to date.
   */
  prepare?: () => void;
  /**
   * Run a row's steps. Runs inside the row's own computed, so it reruns only
   * when something it read changes. `previous` is the value it last returned,
   * so it can hand back the same object when nothing changed. A member
   * outcome must be a new object each time: the list keeps it as the row's
   * result and tells changes apart by identity.
   */
  run: (item: S, previous: O | undefined) => RowOutcome<O, K>;
  /**
   * Track the objects `run` reads as wholes (see `readWholeObjects`): far
   * less memory per row, but a row reruns on any write to an object it read.
   * Safe when a rerun that changed nothing returns an equal outcome, which
   * the list then ignores: true when `run`'s value is the item itself, not
   * when it builds a new object.
   */
  wholeObjects?: boolean;
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
  /** Set when the row's steps threw. */
  readonly failed?: { readonly error: unknown };
}

interface Row<T, O, K> {
  readonly item: T;
  /** The raw object behind `item`: the row's identity. */
  readonly raw: object;
  /** Order of first appearance; breaks ties between equal keys. */
  readonly seq: number;
  readonly result: () => RowResult<O, K>;
  /** The result this row is filed under in the list. */
  applied: RowResult<O, K>;
  /** The last walk that found this row in the source. */
  seenAt: number;
  /** How many times the source holds this row. */
  count: number;
  /** The block this row belongs to, or -1 before it is placed in one. */
  block: number;
}

/** A row whose result changed since it was last filed, and its new result. */
type Change<T, O, K> = readonly [row: Row<T, O, K>, next: RowResult<O, K>];

/** Rows per block. */
const BLOCK = 16;
/** Blocks per group. */
const GROUP = 16;

/**
 * Up to `BLOCK` rows with one computed over all their results. It reruns when
 * one of them changes, and returns the rows whose result differs from where
 * they are filed.
 *
 * Rows stay in their block when other rows come and go, so adding or removing
 * a row replaces only the blocks it touched.
 */
interface Block<T, O, K> {
  readonly rows: ReadonlyArray<Row<T, O, K>>;
  readonly changes: () => ReadonlyArray<Change<T, O, K>>;
}

/**
 * Up to `BLOCK` blocks with one computed over their changes. The list reads
 * one of these per group, so a field edit costs a few dozen cached reads
 * (every group, then one group's blocks, then one block's rows), not N.
 */
interface Group<T, O, K> {
  readonly changes: () => ReadonlyArray<Change<T, O, K>>;
  /** The changes last applied to the list. Set only after an update succeeds. */
  applied: ReadonlyArray<Change<T, O, K>> | undefined;
}

interface Structure<T, O, K> {
  readonly list: ReadonlyArray<Row<T, O, K>>;
  readonly removed: ReadonlyArray<Row<T, O, K>>;
  readonly groups: ReadonlyArray<Group<T, O, K>>;
}

function createBlock<T, O, K>(rows: ReadonlyArray<Row<T, O, K>>): Block<T, O, K> {
  return {
    rows,
    changes: rethrowingComputed(() => {
      const changes: Array<Change<T, O, K>> = [];
      for (const row of rows) {
        const result = row.result();
        if (result.failed) throw result.failed.error;
        if (result !== row.applied) changes.push([row, result]);
      }
      return changes;
    }),
  };
}

function createGroup<T, O, K>(blocks: ReadonlyArray<Block<T, O, K>>): Group<T, O, K> {
  return {
    applied: undefined,
    changes: rethrowingComputed(() => blocks.flatMap((block) => block.changes())),
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
 * small blocks, and blocks into groups, each with a computed that finds which
 * of its rows' outcomes changed. A field edit costs a few dozen cached reads,
 * not N. When the source is a store array, adding or removing rows applies the
 * array's recent splices (see `array-log.ts`) and replaces only the blocks
 * those rows were in. Without a sort, the result is refiltered in source order
 * from cached outcomes on each change.
 */
export function createList<T extends object, O, K>(
  options: ListOptions<T, O, K>,
): () => ReadonlyArray<O> {
  const { source, prepare, compare, offset: offsetOf, limit: limitOf } = options;
  const run = options.wholeObjects
    ? (item: T, previous: O | undefined) => readWholeObjects(() => options.run(item, previous))
    : options.run;

  // Rows by raw object. Each read stamps the rows it finds with `seenAt`, so
  // a row with an older stamp has left the source. (A stamp, rather than
  // moving rows between maps, stays correct when a read throws part-way.)
  const rows = new Map<object, Row<T, O, K>>();
  let reads = 0;
  let nextSeq = 0;
  const out = createReactive<Array<O>>([]) as Array<O>;

  const compareRows = (a: Row<T, O, K>, b: Row<T, O, K>): number =>
    compare!(a.applied.key as K, b.applied.key as K) || a.seq - b.seq;
  // The matching rows by `(key, seq)`. Stale after a read threw part-way (a
  // throwing step or `compare`), so the next read rebuilds it from `rows`
  // instead of trusting it: rows that left the source during the failed read
  // were never taken out of it.
  const sorted = createSortedRows(compareRows);
  let sortedIsStale = false;

  function createRow(item: T, raw: object): Row<T, O, K> {
    return {
      item,
      raw,
      seq: nextSeq++,
      applied: OUTSIDE,
      seenAt: 0,
      count: 0,
      block: -1,
      // A plain computed, not `rethrowingComputed`: a row is small, and there
      // are many. A throw is cached as a `Failed` result, which its block
      // rethrows.
      result: computed((previous: RowResult<O, K> | undefined): RowResult<O, K> => {
        try {
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
          return outcome;
        } catch (error) {
          return { member: false, value: undefined, key: undefined, failed: { error } };
        }
      }),
    };
  }

  // The source's rows in order, the rows that left it, and the blocks.
  // Recomputed only when the source's structure changes.
  let blocks: Array<Block<T, O, K>> = [];
  let groups: Array<Group<T, O, K>> = [];
  const structure = rethrowingComputed(readStructure);
  let current: Structure<T, O, K> | undefined = undefined;
  // Without a sort: the matching rows in source order.
  let matching: ReadonlyArray<Row<T, O, K>> = [];
  // When the source is a store array, the list follows it through the
  // array's log: `mirror` is its rows in order, as of log position
  // `position`. A change then costs the splices since, not a walk.
  let followed: ReadonlyArray<unknown> | undefined = undefined;
  let position = -1;
  let mirror: Array<Row<T, O, K>> = [];

  return rethrowingComputed((): ReadonlyArray<O> => {
    try {
      return update();
    } catch (error) {
      sortedIsStale = true;
      throw error;
    }
  });

  function update(): ReadonlyArray<O> {
    // Tracked: the lookups, the source's structure, each group's changes,
    // the window.
    prepare?.();
    const next = structure();
    const pending = next.groups.map((group) => group.changes());
    const offset = Math.max(0, offsetOf());
    const limit = Math.max(0, limitOf());
    // Untracked: `compare` may read reactive values, and the list must not
    // subscribe to them or to its own output.
    untracked(() => {
      const changes: Array<Change<T, O, K>> = [];
      if (next !== current) {
        for (const row of next.removed) if (row.applied.member) changes.push([row, OUTSIDE]);
      }
      next.groups.forEach((group, g) => {
        if (pending[g] === group.applied) return;
        // A failed update may have filed some of these already.
        for (const change of pending[g]!) if (change[0].applied !== change[1]) changes.push(change);
      });
      const ordered = compare ? applyChanges(changes) : filterChanges(next, changes);
      syncArray(
        out,
        ordered.slice(offset, offset + limit).map((row) => row.applied.value),
      );
    });
    // Nothing threw: record what the list now reflects.
    next.groups.forEach((group, g) => (group.applied = pending[g]));
    current = next;
    return out;
  }

  /** The source's rows in order (once each), the rows that left, and the blocks. */
  function readStructure(): Structure<T, O, K> {
    const items = source();
    const raw = unwrap(items);
    if (raw === items || !Array.isArray(raw)) {
      followed = undefined;
      return walk((fn) => forEachItem(items, fn), []);
    }
    trackArrayItems(raw);
    const log = arrayLog(raw);
    const splices = raw === followed ? splicesSince(log) : undefined;
    const removed: Array<Row<T, O, K>> = [];
    const unplaced: Array<Row<T, O, K>> = [];
    if (splices && applySplices(splices, unplaced, removed)) {
      position = logEnd(log);
      return place(
        mirror,
        unplaced.filter((row) => rows.get(row.raw) === row),
        removed,
      );
    }
    // Walk the raw array: no proxy reads, and the three signals above
    // already cover every change to it.
    followed = undefined;
    let seen = 0;
    const structure = walk((fn) => {
      raw.forEach((item: unknown) => {
        seen++;
        fn(wrap(item) as T);
      });
    }, removed);
    followed = raw;
    mirror = [...structure.list];
    // An array with holes can't be followed by splices; walk it every time.
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
   * Apply `splices` to the mirror. Rows no longer in the source are deleted
   * from `rows` and added to `removed`; new rows are added to `unplaced`.
   * Returns false, for the caller to walk instead, if the source now holds a
   * row twice.
   */
  function applySplices(
    splices: ReadonlyArray<Splice>,
    unplaced: Array<Row<T, O, K>>,
    removed: Array<Row<T, O, K>>,
  ): boolean {
    const touched: Array<Row<T, O, K>> = [];
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
          row = createRow(wrap(raw) as T, raw);
          rows.set(raw, row);
          unplaced.push(row);
        }
        row.count++;
        touched.push(row);
        return row;
      });
      mirror.splice(index, out.length, ...rowsIn);
    }
    let twice = false;
    for (const row of touched) {
      if (row.count > 1) twice = true;
      else if (row.count === 0 && rows.get(row.raw) === row) {
        rows.delete(row.raw);
        removed.push(row);
      }
    }
    return !twice;
  }

  /** Walk `items`: every row in order, once each. Rows not found have left. */
  function walk(
    each: (fn: (item: T) => void) => void,
    removed: Array<Row<T, O, K>>,
  ): Structure<T, O, K> {
    const read = ++reads;
    const list: Array<Row<T, O, K>> = [];
    const unplaced: Array<Row<T, O, K>> = [];
    each((item) => {
      if (typeof item !== "object" || item === null) {
        throw new TypeError("@supergrain/kernel: query rows must be objects.");
      }
      const raw = unwrap(item);
      let row = rows.get(raw);
      if (row === undefined) {
        row = createRow(item, raw);
        rows.set(raw, row);
      } else if (row.seenAt === read) {
        return; // The same object twice counts once.
      }
      row.seenAt = read;
      row.count = 1;
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
    return place(list, unplaced, removed);
  }

  /** Put new rows in blocks and take removed ones out. Safe only once the read succeeded. */
  function place(
    list: ReadonlyArray<Row<T, O, K>>,
    unplaced: ReadonlyArray<Row<T, O, K>>,
    removed: ReadonlyArray<Row<T, O, K>>,
  ): Structure<T, O, K> {
    placeRows(list, unplaced, removed);
    return { list, removed, groups: [...groups] };
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
  ): void {
    const size = BLOCK;
    if (blocks.length + unplaced.length / size > 2 * Math.ceil(list.length / size) + 1) {
      blocks = [];
      for (let start = 0; start < list.length; start += size) {
        blocks.push(placeIn(blocks.length, list.slice(start, start + size)));
      }
      groups = [];
      for (let start = 0; start < blocks.length; start += GROUP) {
        groups.push(createGroup(blocks.slice(start, start + GROUP)));
      }
      return;
    }
    const edited = new Map<number, Array<Row<T, O, K>>>();
    const rowsOf = (b: number): Array<Row<T, O, K>> => {
      let blockRows = edited.get(b);
      if (blockRows === undefined) {
        blockRows =
          b < blocks.length ? blocks[b]!.rows.filter((row) => rows.get(row.raw) === row) : [];
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
    const regroup = new Set<number>();
    for (const [b, blockRows] of edited) {
      blocks[b] = placeIn(b, blockRows);
      regroup.add(Math.floor(b / GROUP));
    }
    for (const g of regroup) {
      groups[g] = createGroup(blocks.slice(g * GROUP, (g + 1) * GROUP));
    }
  }

  function placeIn(b: number, blockRows: ReadonlyArray<Row<T, O, K>>): Block<T, O, K> {
    for (const row of blockRows) row.block = b;
    return createBlock(blockRows);
  }

  /** Without a sort: the matching rows in source order, refiltered only when something changed. */
  function filterChanges(
    next: Structure<T, O, K>,
    changes: ReadonlyArray<Change<T, O, K>>,
  ): Window<Row<T, O, K>> {
    for (const [row, result] of changes) row.applied = result;
    if (next !== current || changes.length > 0) {
      matching = next.list.filter((row) => row.applied.member);
    }
    return matching;
  }

  function applyChanges(changes: ReadonlyArray<Change<T, O, K>>): Window<Row<T, O, K>> {
    // When many rows moved at once (say a filter reads a shared value), sorting
    // from scratch is cheaper than moving each one.
    if (sortedIsStale || changes.length > 16 + sorted.size / 4) {
      for (const [row, next] of changes) row.applied = next;
      sorted.reset([...rows.values()].filter((row) => row.applied.member).sort(compareRows));
      sortedIsStale = false;
      return sorted;
    }
    for (const [row, next] of changes) {
      if (row.applied.member) sorted.remove(row);
      row.applied = next;
      if (next.member) sorted.insert(row);
    }
    return sorted;
  }
}

/** The matching rows in result order; the list reads only its window. */
interface Window<R> {
  slice(start: number, end: number): ReadonlyArray<R>;
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
