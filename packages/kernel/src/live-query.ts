import { setActiveSub } from "alien-signals";

import { unwrap } from "./core";
import { rethrowingComputed } from "./rethrowing-computed";
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
  /** The last read that found this row in the source. */
  seenAt: number;
}

/** A row whose result changed since it was last filed, and its new result. */
type Change<T, K> = readonly [row: Row<T, K>, next: RowResult<K>];

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

  // Rows by raw object. Each read stamps the rows it finds with `seenAt`, so
  // a row with an older stamp has left the source. (A stamp, rather than
  // moving rows between maps, stays correct when a read throws part-way.)
  const rows = new Map<object, Row<T, K>>();
  let reads = 0;
  // The matching rows by `(key, seq)`. `null` after an update threw part-way
  // (a throwing `compare`), so the next read rebuilds it instead of trusting it.
  let sorted: Array<Row<T, K>> | null = [];
  let nextSeq = 0;
  const out = createReactive<Array<T>>([]) as Array<T>;

  const compareRows = (a: Row<T, K>, b: Row<T, K>): number =>
    compare(a.applied.key, b.applied.key) || a.seq - b.seq;

  function createRow(item: T): Row<T, K> {
    return {
      item,
      seq: nextSeq++,
      applied: OUTSIDE,
      seenAt: 0,
      result: rethrowingComputed((previous: RowResult<K> | undefined): RowResult<K> => {
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

  return rethrowingComputed((): ReadonlyArray<T> => {
    // Tracked: the source's structure, each row's cached result, the window.
    const { members, changes } = walkSource();
    const offset = offsetOf();
    const limit = limitOf();
    // Untracked: `compare` may read reactive values, and the query must not
    // subscribe to them or to its own output.
    const prevSub = setActiveSub(undefined);
    try {
      const ordered = orderBy ? applyChanges(changes) : members;
      syncArray(
        out,
        ordered.slice(offset, offset + limit).map((row) => row.item),
      );
    } finally {
      setActiveSub(prevSub);
    }
    return out;
  });

  /**
   * Read the source and every row's result. Returns the matching rows in
   * source order, and the rows to refile in `sorted` (including rows that
   * left the source).
   */
  function walkSource(): { members: Array<Row<T, K>>; changes: Array<Change<T, K>> } {
    const read = ++reads;
    const members: Array<Row<T, K>> = [];
    const changes: Array<Change<T, K>> = [];
    let found = 0;
    forEachItem(from(), (item) => {
      if (typeof item !== "object" || item === null) {
        throw new TypeError("@supergrain/kernel: liveQuery rows must be objects.");
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
      found++;
      const result = row.result();
      // Without `orderBy` nothing is filed in `sorted`, so there's nothing to refile.
      if (orderBy && result !== row.applied) changes.push([row, result]);
      if (result.member) members.push(row);
    });
    if (found < rows.size) {
      for (const [raw, row] of rows) {
        if (row.seenAt !== read) {
          rows.delete(raw);
          if (row.applied.member) changes.push([row, OUTSIDE]);
        }
      }
    }
    return { members, changes };
  }

  function applyChanges(changes: ReadonlyArray<Change<T, K>>): ReadonlyArray<Row<T, K>> {
    // When many rows moved at once (say `where` reads a shared value), sorting
    // from scratch is cheaper than moving each one.
    if (sorted === null || changes.length > 16 + sorted.length / 4) {
      for (const [row, next] of changes) row.applied = next;
      sorted = [...rows.values()].filter((row) => row.applied.member).sort(compareRows);
      return sorted;
    }
    const current = sorted;
    sorted = null;
    for (const [row, next] of changes) {
      if (row.applied.member) current.splice(indexOf(current, row, compareRows), 1);
      row.applied = next;
      if (next.member) current.splice(insertionPoint(current, row, compareRows), 0, row);
    }
    sorted = current;
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

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || Number.isNaN(value);
}

/**
 * A total order over numbers, strings, bigints and arrays of them. Values of
 * different types order by type name; `null`, `undefined` and `NaN` sort last.
 */
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
