/**
 * Rows kept in sorted order, in chunks of up to `2 * LOAD`. Inserting or
 * removing a row splices one short chunk, not one long array, and reading a
 * window skips whole chunks by their sizes.
 *
 * `compare` must be a total order (the list breaks key ties by arrival), and a
 * row must be removed with the key it was inserted with.
 */
export interface SortedRows<R> {
  readonly size: number;
  /** Replace every row with `rows`, which must already be sorted. */
  reset(rows: ReadonlyArray<R>): void;
  insert(row: R): void;
  remove(row: R): void;
  /** The rows from `start` up to, not including, `end`. */
  slice(start: number, end: number): Array<R>;
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

  const removeAt = (c: number, i: number): void => {
    chunks[c]!.splice(i, 1);
    size--;
    if (chunks[c]!.length === 0) chunks.splice(c, 1);
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
        return;
      }
      const c = chunkFor(row);
      const chunk = chunks[c]!;
      chunk.splice(insertionPoint(chunk, row, compare), 0, row);
      if (chunk.length > 2 * LOAD) chunks.splice(c + 1, 0, chunk.splice(LOAD));
    },

    remove(row) {
      const c = chunkFor(row);
      const i = insertionPoint(chunks[c]!, row, compare);
      if (chunks[c]![i] === row) {
        removeAt(c, i);
        return;
      }
      // A miss only happens with an inconsistent `compare` or a key that
      // mutated: find the row by scanning.
      for (let c = 0; c < chunks.length; c++) {
        const i = chunks[c]!.indexOf(row);
        if (i !== -1) {
          removeAt(c, i);
          return;
        }
      }
    },

    slice(start, end) {
      const out: Array<R> = [];
      let skipped = 0;
      for (const chunk of chunks) {
        if (skipped + chunk.length > start) {
          for (let i = Math.max(0, start - skipped); i < chunk.length; i++) {
            if (skipped + i >= end) return out;
            out.push(chunk[i]!);
          }
        }
        skipped += chunk.length;
      }
      return out;
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
