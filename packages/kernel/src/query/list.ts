import { untracked } from "../core";
import { readWholeObjects } from "../read";
import { catchingComputed, rethrowingComputed } from "../rethrowing-computed";
import { createReactive } from "../store";
import { syncArray } from "../sync-array";
import { OUTSIDE, type Change, type Row, type RowResult } from "./row-blocks";
import { createSortedRows } from "./sorted-rows";
import { createSourceRows, type Structure } from "./source-rows";

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

/**
 * The engine under `computedList`: a list of source rows, each run through
 * its steps in its own computed, kept sorted and windowed, that updates
 * **one row at a time**.
 *
 * - each row's steps run in their own `computed`, so the kernel's field
 *   tracking reruns them for the changed row only;
 * - the list keeps the matching rows sorted (see `sorted-rows.ts`), and
 *   moves only the rows whose outcome changed;
 * - the result is one persistent reactive array synced in place (as in
 *   `stableComputed`), so only slots that changed notify.
 *
 * It is pull-based: nothing runs until the list is read, there are no
 * effects, and so there is nothing to dispose.
 *
 * To find the changed row without checking every row, rows are grouped into
 * small blocks, and blocks into groups, each with a computed that finds which
 * of its rows' outcomes changed (see `row-blocks.ts`). A field edit costs a
 * few dozen cached reads, not N. When the source is a store array, adding or
 * removing rows applies the array's recent splices and replaces only the
 * blocks those rows were in (see `source-rows.ts`). Without a sort, the result
 * is refiltered in source order from cached outcomes on each change.
 */
export function createList<T extends object, O, K>(
  options: ListOptions<T, O, K>,
): () => ReadonlyArray<O> {
  const { source, prepare, compare, offset: offsetOf, limit: limitOf } = options;
  const run = options.wholeObjects
    ? (item: T, previous: O | undefined) => readWholeObjects(() => options.run(item, previous))
    : options.run;

  let nextSeq = 0;
  const { rows, read: readStructure } = createSourceRows<T, O, K>(source, createRow);
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
      count: 0,
      block: -1,
      // Its block reads it with `settle`, which rethrows a throw.
      result: catchingComputed((previous: RowResult<O, K> | undefined): RowResult<O, K> => {
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
      }),
    };
  }

  // Recomputed only when the source's structure changes.
  const structure = rethrowingComputed(readStructure);
  let current: Structure<T, O, K> | undefined = undefined;
  // Without a sort: the matching rows in source order.
  let matching: ReadonlyArray<Row<T, O, K>> = [];

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
