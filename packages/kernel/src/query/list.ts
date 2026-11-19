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

export interface ListOptions<S extends object, O, K> {
  /** Read reactively: read only its structure here. */
  source: () => Iterable<S>;
  prepare?: () => void;
  /**
   * Return `previous` when value and key are unchanged, else a new object:
   * the list detects changes by identity.
   */
  run: (item: S, previous: RowResult<O, K> | undefined) => RowResult<O, K>;
  compare: ((a: K, b: K) => number) | undefined;
  offset: () => number;
  limit: () => number;
}

export function createList<T extends object, O, K>(
  options: ListOptions<T, O, K>,
): () => ReadonlyArray<O> {
  const { source, prepare, run, compare, offset: offsetOf, limit: limitOf } = options;

  const feed = createRowFeed<T, O, K>(source, run);
  const out = createReactive<Array<O>>([]) as Array<O>;

  const compareRows = compare
    ? (a: Row<T, O, K>, b: Row<T, O, K>): number =>
        compare(filed(a).key, filed(b).key) || a.order - b.order
    : (a: Row<T, O, K>, b: Row<T, O, K>): number => a.order - b.order;
  // Untrustworthy after a read throws part-way: rows that left the source
  // during it were never removed, so the next read rebuilds it.
  const sorted = createSortedRows(compareRows);
  let sortedIsStale = false;

  let window = new Scratch<O>();
  let shown = new Scratch<O>();
  const addToWindow = { push: (row: Row<T, O, K>) => window.push(filed(row).value) };
  let offset = 0;
  let limit = Infinity;

  return rethrowingComputed((): ReadonlyArray<O> => {
    try {
      prepare?.();
      const next = feed.read();
      offset = offsetOf();
      limit = limitOf();
      // Must stay untracked: `compare` may read reactive values, and the list
      // must not subscribe to them or to its own output.
      feed.apply(next, file);
      return out;
    } catch (error) {
      sortedIsStale = true;
      throw error;
    } finally {
      window.clear();
    }
  });

  function file(changes: Scratch<Change<T, O, K>>, next: Structure<T, O, K>): void {
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

  function showWindow(): void {
    sorted.copy(offset, offset + limit, addToWindow);
    spliceArray(out, shown.items, shown.size, window.items, window.size);
    const built = window;
    window = shown;
    shown = built;
  }

  function mustResort(next: Structure<T, O, K>, changed: number): boolean {
    return sortedIsStale || next.reordered || changed > 16 + sorted.size / 4;
  }

  function resort(next: Structure<T, O, K>, changes: Scratch<Change<T, O, K>>): void {
    fileAll(changes);
    const members = next.list.filter((row) => row.applied.member);
    sorted.reset(compare ? members.sort(compareRows) : members);
    sortedIsStale = false;
  }

  function applyChanges(changes: Scratch<Change<T, O, K>>, inOut: boolean): void {
    for (let i = 0; i < changes.size; i++) {
      const { row, next: result } = changes.at(i);
      const from = row.applied.member ? sorted.remove(row) : -1;
      row.applied = result;
      const to = result.member ? sorted.insert(row) : -1;
      if (inOut) move(from, to, result.value as O);
    }
  }

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

// Unchecked cast: call only on rows known to be members.
function filed<T, O, K>(row: Row<T, O, K>): Extract<RowResult<O, K>, { member: true }> {
  return row.applied as Extract<RowResult<O, K>, { member: true }>;
}
