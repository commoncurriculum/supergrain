/* eslint-disable typescript-eslint/prefer-for-of, prefer-destructuring --
 * Index loops and indexed tuple reads on purpose: in this hot path `for…of`
 * and `[a, b] = tuple` each allocated an iterator per loop (measured with a
 * heap profile of the list bench).
 */
import { rethrowingComputed, settle, type Caught } from "../rethrowing-computed";

/**
 * What a row's steps produce: whether it's in the list, and if so its output
 * value and sort key. A new object only when it changed.
 */
export type RowResult<O, K> =
  | { readonly member: false; readonly value?: undefined; readonly key?: undefined }
  | { readonly member: true; readonly value: O; readonly key: K };

export interface Row<T, O, K> {
  readonly item: T;
  /** The raw object behind `item`: the row's identity. */
  readonly raw: object;
  /**
   * The row's place in the source: labels increase along the source, so
   * ordering rows by it gives source order. Kept up to date by the source's
   * rows; breaks ties between equal keys.
   */
  order: number;
  /** Its latest result. A `catchingComputed`: read it with `settle`. */
  readonly result: () => Caught<RowResult<O, K>>;
  /** The result this row is filed under in the list. */
  applied: RowResult<O, K>;
  /** How many times the source holds this row. */
  count: number;
  /** The block this row belongs to, or -1 before it is placed in one. */
  block: number;
}

/** A row whose result changed since it was last filed, and its new result. */
export type Change<T, O, K> = readonly [row: Row<T, O, K>, next: RowResult<O, K>];

/**
 * Up to `GROUP` blocks with one computed over their changes. The list reads
 * one of these per group, so a field edit costs a few dozen cached reads
 * (every group, then one group's blocks, then one block's rows), not N.
 */
export interface BlockGroup<T, O, K> {
  readonly changes: () => ReadonlyArray<Change<T, O, K>>;
  /** The changes last applied to the list. Set only after an update succeeds. */
  applied: ReadonlyArray<Change<T, O, K>> | undefined;
}

/** The result of a row that isn't in the list. */
// Same fields as a member result, so every result the list reads has one
// shape. With `{ member: false }` alone, field edits ran about 15% slower in
// two paired bench runs.
export const OUTSIDE: RowResult<never, never> = Object.freeze({
  member: false,
  value: undefined,
  key: undefined,
});

/** A row for `item`, not yet filed in the list or placed in a block. */
export function createRow<T, O, K>(
  item: T,
  raw: object,
  result: () => Caught<RowResult<O, K>>,
): Row<T, O, K> {
  return { item, raw, order: 0, result, applied: OUTSIDE, count: 0, block: -1 };
}

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

/** No changes. Shared, so finding none allocates nothing. */
const NO_CHANGES: ReadonlyArray<never> = Object.freeze([]);

function createBlock<T, O, K>(rows: ReadonlyArray<Row<T, O, K>>): Block<T, O, K> {
  return {
    rows,
    changes: rethrowingComputed(() => {
      let changes: Array<Change<T, O, K>> | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const result = settle(row.result);
        if (result !== row.applied) (changes ??= []).push([row, result]);
      }
      return changes ?? NO_CHANGES;
    }),
  };
}

function createGroup<T, O, K>(blocks: ReadonlyArray<Block<T, O, K>>): BlockGroup<T, O, K> {
  return {
    applied: undefined,
    // Its blocks' unfiled changes: one block's array as is when only it has
    // any. A block keeps returning changes the list has since filed, until
    // one of its rows changes again; those are left out.
    changes: rethrowingComputed(() => {
      let found: ReadonlyArray<Change<T, O, K>> = NO_CHANGES;
      let joined: Array<Change<T, O, K>> | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value
      for (let b = 0; b < blocks.length; b++) {
        const changes = blocks[b]!.changes();
        if (!hasUnfiled(changes)) {
          // Nothing to add.
        } else if (found.length === 0) found = changes;
        else {
          joined ??= [...found];
          for (let i = 0; i < changes.length; i++) joined.push(changes[i]!);
        }
      }
      return joined ?? found;
    }),
  };
}

function hasUnfiled<T, O, K>(changes: ReadonlyArray<Change<T, O, K>>): boolean {
  for (let i = 0; i < changes.length; i++)
    if (changes[i]![0].applied !== changes[i]![1]) return true;
  return false;
}

/**
 * The list's rows in blocks, and blocks in groups. `isLive(row)` says whether
 * a row is still in the source.
 */
export function createRowBlocks<T, O, K>(isLive: (row: Row<T, O, K>) => boolean) {
  let blocks: Array<Block<T, O, K>> = [];
  let groups: Array<BlockGroup<T, O, K>> = [];

  function placeIn(b: number, blockRows: ReadonlyArray<Row<T, O, K>>): Block<T, O, K> {
    for (const row of blockRows) row.block = b;
    return createBlock(blockRows);
  }

  function regroupAll(list: ReadonlyArray<Row<T, O, K>>): void {
    blocks = [];
    for (let start = 0; start < list.length; start += BLOCK) {
      blocks.push(placeIn(blocks.length, list.slice(start, start + BLOCK)));
    }
    groups = [];
    for (let start = 0; start < blocks.length; start += GROUP) {
      groups.push(createGroup(blocks.slice(start, start + GROUP)));
    }
  }

  /**
   * Take removed rows out of their blocks and put new rows in the last
   * block, or new ones, then return the groups. Only the blocks that changed
   * are replaced. When removals have left too many sparse blocks, regroup
   * every row of `list`. Safe only once the read that found these rows
   * succeeded. The groups returned are valid until the next call, which may
   * change them in place.
   */
  return function place(
    list: ReadonlyArray<Row<T, O, K>>,
    unplaced: ReadonlyArray<Row<T, O, K>>,
    removed: ReadonlyArray<Row<T, O, K>>,
  ): ReadonlyArray<BlockGroup<T, O, K>> {
    if (blocks.length + unplaced.length / BLOCK > 2 * Math.ceil(list.length / BLOCK) + 1) {
      regroupAll(list);
      return groups;
    }
    const edited = new Map<number, Array<Row<T, O, K>>>();
    const rowsOf = (b: number): Array<Row<T, O, K>> => {
      let blockRows = edited.get(b);
      if (blockRows === undefined) {
        blockRows = b < blocks.length ? blocks[b]!.rows.filter(isLive) : [];
        edited.set(b, blockRows);
      }
      return blockRows;
    };
    for (const row of removed) if (row.block !== -1) rowsOf(row.block);
    let last = blocks.length - 1;
    for (const row of unplaced) {
      const lastSize = edited.get(last)?.length ?? blocks[last]?.rows.length ?? BLOCK;
      if (lastSize >= BLOCK) last++;
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
    return groups;
  };
}
