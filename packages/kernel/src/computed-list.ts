import { defaultCompare } from "./query/compare";
import { createList, toGetter } from "./query/list";

/** Options for {@link computedList}. */
export interface ComputedListOptions<T extends object, K> {
  /** The source rows. Read reactively; only its structure should be read here. */
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

/**
 * A filtered, sorted, windowed view of a reactive collection that updates
 * **one row at a time**.
 *
 * A `stableComputed(() => xs.filter(where).sort(by).slice(0, 10))` already
 * skips changes to fields it never read, but when a field it did read changes,
 * it reruns `where` on every row and sorts everything again. `computedList`
 * keeps the first property and fixes the second: each row's `where` and
 * `orderBy` run in their own computed, and the list moves only the rows whose
 * result changed. See `createList` for how.
 *
 * Call the list in every reader rather than holding on to the array it
 * returns — calling it is what brings the array up to date.
 */
export function computedList<T extends object, K = unknown>(
  options: ComputedListOptions<T, K>,
): () => ReadonlyArray<T> {
  const { from, where, orderBy } = options;
  return createList<T, T, K | undefined>({
    source: from,
    run: (item) => {
      if (where && !where(item)) return { member: false };
      return { member: true, value: item, key: orderBy?.(item) };
    },
    compare: orderBy
      ? ((options.compare ?? defaultCompare) as (a: K | undefined, b: K | undefined) => number)
      : undefined,
    offset: toGetter(options.offset, 0),
    limit: toGetter(options.limit, Infinity),
  });
}
