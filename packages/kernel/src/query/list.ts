import type { Change, Row, RowResult } from "./row-blocks";
import type { Structure } from "./source-rows";

/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { unwrap } from "../core";
import { rethrowingComputed } from "../rethrowing-computed";
import { createReactive } from "../store";
import { spliceArray } from "../sync-array";
import { createRowFeed, fileAll } from "./row-feed";
import { Scratch } from "./scratch";
import { createSortedRows } from "./sorted-rows";

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
 * blocks those rows were in (see `source-rows.ts`). Without a sort, the rows
 * are kept in source order the same way, by their place in the source.
 */
export function createList<T extends object, O, K>(
  options: ListOptions<T, O, K>,
): () => ReadonlyArray<O> {
  const { source, prepare, run, compare, offset: offsetOf, limit: limitOf } = options;

  const feed = createRowFeed<T, O, K>(source, run);
  const out = createReactive<Array<O>>([]) as Array<O>;

  // By key, then by place in the source. Without a sort, by place alone.
  const compareRows = compare
    ? (a: Row<T, O, K>, b: Row<T, O, K>): number =>
        compare(filed(a).key, filed(b).key) || a.order - b.order
    : (a: Row<T, O, K>, b: Row<T, O, K>): number => a.order - b.order;
  // The matching rows, in that order. Stale after a read threw part-way (a
  // throwing step or `compare`), so the next read rebuilds it from the
  // source's rows instead of trusting it: rows that left the source during
  // the failed read were never taken out of it. Also rebuilt when the
  // source's rows changed order among themselves.
  const sorted = createSortedRows(compareRows);
  let sortedIsStale = false;

  // Kept between updates, so an update allocates no array of its own: the
  // window being built, and the one `out` holds now (to compare by identity).
  let window = new Scratch<O>();
  let shown = new Scratch<O>();
  const addToWindow = { push: (row: Row<T, O, K>) => window.push(filed(row).value) };
  // The window bounds of the update in progress, read tracked before `file`.
  let offset = 0;
  let limit = Infinity;

  return rethrowingComputed((): ReadonlyArray<O> => {
    try {
      // Tracked: the lookups, the source's structure, each group's changes,
      // the window.
      prepare?.();
      const next = feed.read();
      offset = offsetOf();
      limit = limitOf();
      // Untracked: `compare` may read reactive values, and the list must not
      // subscribe to them or to its own output.
      feed.apply(next, file);
      return out;
    } catch (error) {
      sortedIsStale = true;
      throw error;
    } finally {
      window.clear();
    }
  });

  /** File every change, and bring `out` up to date. */
  function file(changes: Scratch<Change<T, O, K>>, next: Structure<T, O, K>): void {
    // When `out` shows every row and was up to date, move each changed
    // row in it, one splice per row, instead of rebuilding it.
    const resorting = mustResort(next, changes.size);
    const inOut =
      !resorting &&
      offset === 0 &&
      limit === Infinity &&
      shown.size === sorted.size &&
      changes.size <= 32;
    if (resorting) resort(next, changes);
    else applyChanges(changes, inOut);
    if (!inOut) showWindow();
  }

  /** Rebuild the window from the sorted rows, and splice `out` to match it. */
  function showWindow(): void {
    sorted.copy(offset, offset + limit, addToWindow);
    spliceArray(out, shown.items, shown.size, window.items, window.size);
    const built = window;
    window = shown;
    shown = built;
  }

  /**
   * Whether to sort every row again rather than move the changed ones: after
   * a throw, after the source's rows changed order, or when many rows moved
   * at once (say a filter reads a shared value), which is cheaper to sort.
   */
  function mustResort(next: Structure<T, O, K>, changed: number): boolean {
    return sortedIsStale || next.reordered || changed > 16 + sorted.size / 4;
  }

  function resort(next: Structure<T, O, K>, changes: Scratch<Change<T, O, K>>): void {
    fileAll(changes);
    const members = next.list.filter((row) => row.applied.member);
    // The source's rows are already in source order.
    sorted.reset(compare ? members.sort(compareRows) : members);
    sortedIsStale = false;
  }

  /**
   * Move each changed row in the sorted rows. With `inOut`, `out` (and
   * `shown`, which mirrors it) hold every sorted row, and each move is made
   * there too.
   */
  function applyChanges(changes: Scratch<Change<T, O, K>>, inOut: boolean): void {
    for (let i = 0; i < changes.size; i++) {
      const { row, next: result } = changes.at(i);
      const from = row.applied.member ? sorted.remove(row) : -1;
      row.applied = result;
      const to = result.member ? sorted.insert(row) : -1;
      if (inOut) move(from, to, result.value as O);
    }
  }

  /** Move a row in `out` from place `from` to `to`, either -1 for none. */
  function move(from: number, to: number, value: O): void {
    if (from === to) {
      if (from === -1 || shown.at(from) === value) return;
      out.splice(from, 1, unwrap(value));
      shown.items[from] = value;
      return;
    }
    if (from !== -1) {
      out.splice(from, 1);
      shown.removeAt(from);
    }
    if (to !== -1) {
      out.splice(to, 0, unwrap(value));
      shown.insertAt(to, value);
    }
  }
}

/**
 * A matching row's filed result. Only for rows in the result (the sorted
 * rows, or the window), which are all members.
 */
function filed<T, O, K>(row: Row<T, O, K>): Extract<RowResult<O, K>, { member: true }> {
  return row.applied as Extract<RowResult<O, K>, { member: true }>;
}
