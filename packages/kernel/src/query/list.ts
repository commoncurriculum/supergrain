/* eslint-disable typescript-eslint/prefer-for-of, prefer-destructuring --
 * Index loops and indexed tuple reads on purpose: in this hot path `for…of`
 * and `[a, b] = tuple` each allocated an iterator per loop (measured with a
 * heap profile of the list bench).
 */
import { setActiveSub } from "alien-signals";

import { catchingComputed, rethrowingComputed } from "../rethrowing-computed";
import { createReactive } from "../store";
import { syncArray } from "../sync-array";
import { OUTSIDE, type Change, type Row, type RowResult } from "./row-blocks";
import { Scratch } from "./scratch";
import { createSortedRows, type SortedRows } from "./sorted-rows";
import { createSourceRows, type Structure } from "./source-rows";

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
   * when something it read changes. Return `previous` (the row's last
   * result) when its value and key are the same, so the list isn't dirtied
   * by edits that don't move the row; otherwise a new object, since the list
   * tells changes apart by identity. Return `OUTSIDE` for a row not in the list.
   */
  run: (item: S, previous: RowResult<O, K> | undefined) => RowResult<O, K>;
  /** Compare sort keys, or `undefined` to keep source order. */
  compare: ((a: K, b: K) => number) | undefined;
  /** Rows to skip from the start of the result: a whole count, at least 0. Read reactively. */
  offset: () => number;
  /** Most rows to return: a whole count (or Infinity), at least 0. Read reactively. */
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
  const { source, prepare, run, compare, offset: offsetOf, limit: limitOf } = options;

  const readStructure = createSourceRows<T, O, K>(source, resultOf);
  const out = createReactive<Array<O>>([]) as Array<O>;

  const compareRows = (a: Row<T, O, K>, b: Row<T, O, K>): number =>
    compare!(filed(a).key, filed(b).key) || a.seq - b.seq;
  // The matching rows by `(key, seq)`. Stale after a read threw part-way (a
  // throwing step or `compare`), so the next read rebuilds it from the
  // source's rows instead of trusting it: rows that left the source during
  // the failed read were never taken out of it.
  const sorted = createSortedRows(compareRows);
  let sortedIsStale = false;

  /** A row's result, in its own computed. Its block reads it with `settle`. */
  function resultOf(item: T) {
    return catchingComputed((previous: RowResult<O, K> | undefined) => run(item, previous));
  }

  // Recomputed only when the source's structure changes.
  const structure = rethrowingComputed(readStructure);
  let current: Structure<T, O, K> | undefined = undefined;
  // Kept between updates, so an update allocates no arrays of its own:
  // each group's changes, the changes to apply, and the window's values.
  const pending = new Scratch<ReadonlyArray<Change<T, O, K>>>();
  const changes = new Scratch<Change<T, O, K>>();
  const window = new Scratch<O>();
  const addToWindow = { push: (row: Row<T, O, K>) => window.push(filed(row).value) };
  // Without a sort: the matching rows in source order.
  const matching = new Scratch<Row<T, O, K>>();

  return rethrowingComputed((): ReadonlyArray<O> => {
    try {
      return update();
    } catch (error) {
      sortedIsStale = true;
      throw error;
    } finally {
      pending.clear();
      changes.clear();
      window.clear();
    }
  });

  function update(): ReadonlyArray<O> {
    // Tracked: the lookups, the source's structure, each group's changes,
    // the window.
    prepare?.();
    const next = structure();
    const { groups } = next;
    for (let g = 0; g < groups.length; g++) pending.push(groups[g]!.changes());
    const offset = offsetOf();
    const limit = limitOf();
    // Untracked: `compare` may read reactive values, and the list must not
    // subscribe to them or to its own output.
    const outer = setActiveSub(undefined);
    try {
      // Already OUTSIDE if an earlier update with this structure succeeded.
      const { removed } = next;
      for (let i = 0; i < removed.length; i++) {
        if (removed[i]!.applied.member) changes.push([removed[i]!, OUTSIDE]);
      }
      for (let g = 0; g < groups.length; g++) {
        const groupChanges = pending.at(g);
        if (groupChanges !== groups[g]!.applied) addUnfiled(groupChanges);
      }
      if (compare) applyChanges(next).copy(offset, offset + limit, addToWindow);
      else addMatching(next, offset, offset + limit);
      syncArray(out, window.items, window.size);
    } finally {
      setActiveSub(outer);
    }
    // Nothing threw: record what the list now reflects.
    for (let g = 0; g < groups.length; g++) groups[g]!.applied = pending.at(g);
    current = next;
    return out;
  }

  /** Add the changes not yet filed. A failed update may have filed some already. */
  function addUnfiled(groupChanges: ReadonlyArray<Change<T, O, K>>): void {
    for (let i = 0; i < groupChanges.length; i++) {
      const change = groupChanges[i]!;
      if (change[0].applied !== change[1]) changes.push(change);
    }
  }

  /** File every change. */
  function fileChanges(): void {
    for (let i = 0; i < changes.size; i++) {
      const change = changes.at(i);
      change[0].applied = change[1];
    }
  }

  /**
   * Without a sort: add the window of the matching rows, in source order, to
   * the window. They are refiltered only when something changed.
   */
  function addMatching(next: Structure<T, O, K>, start: number, end: number): void {
    fileChanges();
    if (next !== current || changes.size > 0) {
      matching.clear();
      const { list } = next;
      for (let i = 0; i < list.length; i++) if (list[i]!.applied.member) matching.push(list[i]!);
    }
    const stop = Math.min(end, matching.size);
    for (let i = start; i < stop; i++) addToWindow.push(matching.at(i));
  }

  function applyChanges(next: Structure<T, O, K>): SortedRows<Row<T, O, K>> {
    // When many rows moved at once (say a filter reads a shared value), sorting
    // from scratch is cheaper than moving each one.
    if (sortedIsStale || changes.size > 16 + sorted.size / 4) {
      fileChanges();
      sorted.reset(next.list.filter((row) => row.applied.member).sort(compareRows));
      sortedIsStale = false;
      return sorted;
    }
    for (let i = 0; i < changes.size; i++) {
      const change = changes.at(i);
      const row = change[0];
      const result = change[1];
      if (row.applied.member) sorted.remove(row);
      row.applied = result;
      if (result.member) sorted.insert(row);
    }
    return sorted;
  }
}

/**
 * A matching row's filed result. Only for rows in the result (the sorted
 * rows, or the window), which are all members.
 */
function filed<T, O, K>(row: Row<T, O, K>): Extract<RowResult<O, K>, { member: true }> {
  return row.applied as Extract<RowResult<O, K>, { member: true }>;
}
