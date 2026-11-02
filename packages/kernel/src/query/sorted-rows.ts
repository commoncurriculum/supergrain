/**
 * Rows kept in sorted order, in chunks of up to `2 * LOAD`. Inserting or
 * removing a row splices one short chunk, not one long array, and reading a
 * window skips whole chunks by their sizes.
 *
 * `compare` must be a total order (the list breaks key ties by place in the
 * source), and a
 * row must be removed with the key it was inserted with.
 */
export interface SortedRows<R> {
  readonly size: number;
  /** Replace every row with `rows`, which must already be sorted. */
  reset(rows: ReadonlyArray<R>): void;
  /** Insert `row`; returns its place among the rows. */
  insert(row: R): number;
  /** Remove `row`; returns the place it had. */
  remove(row: R): number;
  /** Push the rows from `start` up to, not including, `end` onto `into`. Whole counts. */
  copy(start: number, end: number, into: { push(row: R): void }): void;
}

const LOAD = 64;

export function createSortedRows<R>(compare: (a: R, b: R) => number): SortedRows<R> {
  let chunks: Array<Array<R>> = [];
  let size = 0;

  // The first chunk whose last row orders at or after `row`, or the last chunk.
  const chunkFor = (row: R): number => {
    let low = 0;
    let high = chunks.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compare(chunks[mid]!.at(-1)!, row) < 0) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  /** The place of row `i` of chunk `c` among all rows. */
  const placeOf = (c: number, i: number): number => {
    for (let before = 0; before < c; before++) i += chunks[before]!.length;
    return i;
  };

  const removeAt = (c: number, i: number): number => {
    const place = placeOf(c, i);
    chunks[c]!.splice(i, 1);
    size--;
    if (chunks[c]!.length === 0) chunks.splice(c, 1);
    return place;
  };

  return {
    get size() {
      return size;
    },

    reset(rows) {
      chunks = [];
      for (let start = 0; start < rows.length; start += LOAD) {
        chunks.push(rows.slice(start, start + LOAD));
      }
      size = rows.length;
    },

    insert(row) {
      size++;
      if (chunks.length === 0) {
        chunks.push([row]);
        return 0;
      }
      const c = chunkFor(row);
      const chunk = chunks[c]!;
      const i = insertionPoint(chunk, row, compare);
      chunk.splice(i, 0, row);
      const place = placeOf(c, i);
      if (chunk.length > 2 * LOAD) chunks.splice(c + 1, 0, chunk.splice(LOAD));
      return place;
    },

    remove(row) {
      const c = chunkFor(row);
      const i = insertionPoint(chunks[c]!, row, compare);
      if (chunks[c]![i] === row) return removeAt(c, i);
      // A miss only happens with an inconsistent `compare`, a key that
      // mutated, or a row that left the source with its last label: find
      // the row by scanning.
      for (let c = 0; c < chunks.length; c++) {
        const i = chunks[c]!.indexOf(row);
        if (i !== -1) return removeAt(c, i);
      }
      /* c8 ignore next -- only rows in the list are removed */
      return -1;
    },

    copy(start, end, into) {
      let skipped = 0;
      for (const chunk of chunks) {
        if (skipped + chunk.length > start) {
          for (let i = Math.max(0, start - skipped); i < chunk.length; i++) {
            if (skipped + i >= end) return;
            into.push(chunk[i]!);
          }
        }
        skipped += chunk.length;
      }
    },
  };
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
