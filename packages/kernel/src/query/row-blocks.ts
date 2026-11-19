/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { rethrowingComputed, settle, type Caught } from "../rethrowing-computed";

// Must be a new object only when it changed: consumers compare by identity.
export type RowResult<O, K> =
  | { readonly member: false; readonly value?: undefined; readonly key?: undefined }
  | { readonly member: true; readonly value: O; readonly key: K };

export interface Row<T, O, K> {
  readonly item: T;
  readonly raw: object;
  order: number;
  /** Read with `settle`, which rethrows a cached throw. */
  readonly result: () => Caught<RowResult<O, K>>;
  applied: RowResult<O, K>;
  count: number;
  block: number;
}

export interface Change<T, O, K> {
  readonly row: Row<T, O, K>;
  readonly next: RowResult<O, K>;
}

export interface BlockGroup<T, O, K> {
  readonly changes: () => ReadonlyArray<Change<T, O, K>>;
  /** Set only after an update succeeds. */
  applied: ReadonlyArray<Change<T, O, K>> | undefined;
}

// Same fields as a member result so V8 sees one shape; `{ member: false }`
// alone made field edits ~15% slower.
export const OUTSIDE: RowResult<never, never> = Object.freeze({
  member: false,
  value: undefined,
  key: undefined,
});

export function createRow<T, O, K>(
  item: T,
  raw: object,
  result: () => Caught<RowResult<O, K>>,
): Row<T, O, K> {
  return { item, raw, order: 0, result, applied: OUTSIDE, count: 0, block: -1 };
}

const BLOCK = 16;
const GROUP = 16;

interface Block<T, O, K> {
  readonly rows: ReadonlyArray<Row<T, O, K>>;
  readonly changes: () => ReadonlyArray<Change<T, O, K>>;
}

const NO_CHANGES: ReadonlyArray<never> = Object.freeze([]);

function createBlock<T, O, K>(rows: ReadonlyArray<Row<T, O, K>>): Block<T, O, K> {
  return {
    rows,
    changes: rethrowingComputed(() => {
      let changes: Array<Change<T, O, K>> | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const result = settle(row.result);
        if (result !== row.applied) (changes ??= []).push({ row, next: result });
      }
      return changes ?? NO_CHANGES;
    }),
  };
}

function createGroup<T, O, K>(blocks: ReadonlyArray<Block<T, O, K>>): BlockGroup<T, O, K> {
  return {
    applied: undefined,
    // A block keeps returning changes the list already filed until one of its
    // rows changes again, so those must be filtered out here.
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
    if (changes[i]!.row.applied !== changes[i]!.next) return true;
  return false;
}

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

  // Call only after the read that found these rows succeeded. The returned
  // groups may be changed in place by the next call.
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
