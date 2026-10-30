import { computed, setActiveSub } from "alien-signals";

import { unwrap } from "./core";
import { createReactive } from "./store";
import { syncArray } from "./sync-array";

/** Options for {@link liveQuery}. */
export interface LiveQueryOptions<T extends object, K> {
  /** The rows to query. Read reactively; only its structure should be read here. */
  from: () => Iterable<T>;
  /** Keep a row when this returns true. Omit to keep every row. */
  where?: (row: T) => boolean;
  /**
   * The row's sort key. Omit to keep source order. Keys are compared with
   * `compare`; the default orders numbers, strings, bigints and arrays of them
   * (element by element), with `null`, `undefined` and `NaN` last. Rows with
   * equal keys keep the order they first appeared in the source. Return plain
   * values, not the row itself: a key that changes in place can't be found
   * again at its old position.
   */
  orderBy?: (row: T) => K;
  /** Compare two sort keys. Must be a consistent total order. */
  compare?: (a: K, b: K) => number;
  /** Rows to skip from the start of the sorted result. A function is read reactively. */
  offset?: number | (() => number);
  /** Most rows to return. A function is read reactively. */
  limit?: number | (() => number);
}

/** A row's latest `where`/`orderBy` result. A new object only when it changed. */
interface RowResult<K> {
  readonly member: boolean;
  readonly key: K | undefined;
}

interface Row<T, K> {
  readonly item: T;
  /** Order of first appearance; breaks ties between equal keys. */
  readonly seq: number;
  readonly result: () => RowResult<K>;
  /** The result this row is filed under in `sorted`. */
  applied: RowResult<K>;
  /** The result to file it under on this read, when it differs from `applied`. */
  next: RowResult<K>;
  /** The last read of the query that saw this row in the source. */
  seen: number;
}

const OUTSIDE: RowResult<never> = Object.freeze({ member: false, key: undefined });

/**
 * A filtered, sorted, windowed view of a reactive collection that updates
 * **one row at a time**.
 *
 * A `stableComputed(() => xs.filter(where).sort(by).slice(0, 10))` already
 * skips changes to fields it never read, but when a field it did read changes,
 * it reruns `where` on every row and sorts everything again. `liveQuery` keeps
 * the first property and fixes the second:
 *
 * - each row gets its own `computed` for `where` and `orderBy`, so the kernel's
 *   field tracking reruns them for the changed row only;
 * - the query keeps the matching rows in a sorted array, and moves only the
 *   rows whose result changed, with a binary search;
 * - the result is one persistent reactive array synced in place (as in
 *   `stableComputed`), so only slots that changed notify.
 *
 * It is pull-based: nothing runs until the query is read, there are no
 * effects, and so there is nothing to dispose. Read `query()` in every reader
 * rather than holding on to the array it returns — reading `query()` is what
 * brings the array up to date.
 *
 * A change still costs one pass over the source that checks each row's cached
 * result (no `where`/`orderBy` calls for unchanged rows). Removing that pass
 * needs the source to report which rows changed, which kernel collections
 * don't do today.
 */
export function liveQuery<T extends object, K = unknown>(
  options: LiveQueryOptions<T, K>,
): () => ReadonlyArray<T> {
  const { from, where, orderBy } = options;
  const compare = (options.compare ?? defaultCompare) as (
    a: K | undefined,
    b: K | undefined,
  ) => number;
  const offsetOf = toGetter(options.offset, 0);
  const limitOf = toGetter(options.limit, Infinity);

  const rows = new Map<object, Row<T, K>>();
  let sorted: Array<Row<T, K>> = [];
  let needsRebuild = false;
  let nextSeq = 0;
  let read = 0;
  const out = createReactive<Array<T>>([]) as Array<T>;

  const compareRows = (a: Row<T, K>, b: Row<T, K>): number =>
    compare(a.applied.key, b.applied.key) || a.seq - b.seq;

  function createRow(item: T): Row<T, K> {
    return {
      item,
      seq: nextSeq++,
      applied: OUTSIDE,
      next: OUTSIDE,
      seen: 0,
      result: computed((previous?: RowResult<K>): RowResult<K> => {
        const member = where ? Boolean(where(item)) : true;
        const key = member && orderBy ? orderBy(item) : undefined;
        // Hand back the previous object when nothing changed, so the query
        // isn't dirtied by edits that don't move this row.
        if (
          previous &&
          previous.member === member &&
          (!member || !orderBy || compare(previous.key, key) === 0)
        ) {
          return previous;
        }
        return { member, key };
      }),
    };
  }

  return computed((): ReadonlyArray<T> => {
    read++;
    // Tracked: the source's structure and each row's cached result.
    const changed: Array<Row<T, K>> = [];
    const inOrder: Array<Row<T, K>> = [];
    let seenCount = 0;
    forEachItem(from(), (item) => {
      if (typeof item !== "object" || item === null) {
        throw new TypeError("@supergrain/kernel: liveQuery rows must be objects.");
      }
      const raw = unwrap(item);
      let row = rows.get(raw);
      if (row === undefined) {
        row = createRow(item);
        rows.set(raw, row);
      } else if (row.seen === read) {
        return; // The same object twice counts once.
      }
      row.seen = read;
      seenCount++;
      const result = row.result();
      if (orderBy && result !== row.applied) {
        row.next = result;
        changed.push(row);
      }
      if (!orderBy && result.member) inOrder.push(row);
    });
    const offset = offsetOf();
    const limit = limitOf();

    // Untracked: `compare` may read reactive values, and the query must not
    // subscribe to them or to its own output.
    const prevSub = setActiveSub(undefined);
    try {
      if (seenCount < rows.size) dropRowsNotSeen(changed);
      const window = orderBy
        ? applyChanges(changed).slice(offset, offset + limit)
        : inOrder.slice(offset, offset + limit);
      syncArray(
        out,
        window.map((row) => row.item),
      );
    } finally {
      setActiveSub(prevSub);
    }
    return out;
  });

  /** Forget rows that left the source, queueing their removal from `sorted`. */
  function dropRowsNotSeen(changed: Array<Row<T, K>>): void {
    for (const [raw, row] of rows) {
      if (row.seen !== read) {
        rows.delete(raw);
        if (row.applied.member) {
          row.next = OUTSIDE;
          changed.push(row);
        }
      }
    }
  }

  function applyChanges(changed: ReadonlyArray<Row<T, K>>): ReadonlyArray<Row<T, K>> {
    if (changed.length === 0 && !needsRebuild) return sorted;
    // When many rows moved at once (say `where` reads a shared value), sorting
    // from scratch is cheaper than moving each one.
    const rebuild = needsRebuild || changed.length > 16 + sorted.length / 4;
    // Stays set if `compare` throws part-way through, so the next read
    // rebuilds instead of trusting a half-updated `sorted`.
    needsRebuild = true;
    if (rebuild) {
      for (const row of changed) row.applied = row.next;
      sorted = [];
      for (const row of rows.values()) if (row.applied.member) sorted.push(row);
      sorted.sort(compareRows);
    } else {
      for (const row of changed) {
        if (row.applied.member) sorted.splice(indexOfRow(row), 1);
        row.applied = row.next;
        if (row.applied.member) sorted.splice(insertionPoint(row), 0, row);
      }
    }
    needsRebuild = false;
    return sorted;
  }

  /** Where `row` sits in `sorted`, found by its applied key. */
  function indexOfRow(row: Row<T, K>): number {
    const i = insertionPoint(row);
    if (sorted[i] === row) return i;
    // Only reachable with an inconsistent `compare` or a key that mutated.
    return sorted.indexOf(row);
  }

  /** The first index whose row sorts at or after `row`. */
  function insertionPoint(row: Row<T, K>): number {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compareRows(sorted[mid]!, row) < 0) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}

function toGetter(value: number | (() => number) | undefined, fallback: number): () => number {
  if (typeof value === "function") return value;
  const fixed = value ?? fallback;
  return () => fixed;
}

// A kernel array's `forEach` subscribes to its structure with three signals;
// `for...of` would subscribe to every index.
function forEachItem<T>(source: Iterable<T>, fn: (item: T) => void): void {
  if (Array.isArray(source)) {
    (source as ReadonlyArray<T>).forEach((item) => fn(item));
  } else {
    for (const item of source) fn(item);
  }
}

/**
 * A total order over numbers, strings, bigints and arrays of them. Values of
 * different types order by type name; `null`, `undefined` and `NaN` sort last.
 */
function isMissing(value: unknown): boolean {
  return value === null || value === undefined || Number.isNaN(value);
}

function defaultCompare(a: unknown, b: unknown): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing || bMissing) return Number(aMissing) - Number(bMissing);
  if (Array.isArray(a) && Array.isArray(b)) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      const order = defaultCompare(a[i], b[i]);
      if (order !== 0) return order;
    }
    return a.length - b.length;
  }
  const aType = typeof a;
  const bType = typeof b;
  if (aType !== bType) return aType < bType ? -1 : 1;
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
}
