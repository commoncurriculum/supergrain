/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { setActiveSub } from "alien-signals";

import { catchingComputed, rethrowingComputed } from "../rethrowing-computed";
import { OUTSIDE, type Change, type RowResult } from "./row-blocks";
import { Scratch } from "./scratch";
import { createSourceRows, type Structure } from "./source-rows";

/**
 * The source's rows, each run in its own computed, and the rows whose
 * result changed since it was last filed. Both the list and the index under
 * lookups and `groupBy` are built on this. One update is two calls:
 *
 * 1. `read()`, tracked: the source's structure and each block group's changes.
 * 2. `apply(next, file)`: calls `file(changes, next)` untracked, with the
 *    changes not yet filed. Skip it if something between the two throws. `file` files each one (sets `row.applied`) as it
 *    moves the row. If `file` returns, the feed records what was filed; if
 *    it throws, the next update hands the unfiled changes over again.
 */
export function createRowFeed<T extends object, O, K>(
  source: () => Iterable<T>,
  run: (item: T, previous: RowResult<O, K> | undefined) => RowResult<O, K>,
) {
  /** A row's result, in its own computed. Its block reads it with `settle`. */
  const resultOf = (item: T) =>
    catchingComputed((previous: RowResult<O, K> | undefined) => run(item, previous));
  // Recomputed only when the source's structure changes.
  const structure = rethrowingComputed(createSourceRows<T, O, K>(source, resultOf));
  // Kept between updates, so an update allocates no arrays of its own.
  const pending = new Scratch<ReadonlyArray<Change<T, O, K>>>();
  const changes = new Scratch<Change<T, O, K>>();

  /**
   * Put the changes not yet filed in `changes`: rows that left while filed
   * as members, then each block group's unfiled changes. A failed update
   * may have filed some already.
   */
  function collect(next: Structure<T, O, K>): void {
    const { removed, blockGroups } = next;
    for (let i = 0; i < removed.length; i++) {
      if (removed[i]!.applied.member) changes.push([removed[i]!, OUTSIDE]);
    }
    for (let g = 0; g < blockGroups.length; g++) {
      const groupChanges = pending.at(g);
      if (groupChanges !== blockGroups[g]!.applied) {
        for (let i = 0; i < groupChanges.length; i++) {
          const change = groupChanges[i]!;
          if (change[0].applied !== change[1]) changes.push(change);
        }
      }
    }
  }

  return {
    /** Tracked: the source's structure, and each block group's changes. */
    read(): Structure<T, O, K> {
      // Starts afresh: an update that threw before `apply` left its own.
      pending.clear();
      const next = structure();
      const { blockGroups } = next;
      for (let g = 0; g < blockGroups.length; g++) pending.push(blockGroups[g]!.changes());
      return next;
    },

    /** File the changes `read` found (see above). Call after every `read`. */
    apply(
      next: Structure<T, O, K>,
      file: (changes: Scratch<Change<T, O, K>>, next: Structure<T, O, K>) => void,
    ): void {
      const outer = setActiveSub(undefined);
      try {
        collect(next);
        file(changes, next);
        // Nothing threw: record which changes each group's rows now reflect.
        const { blockGroups } = next;
        for (let g = 0; g < blockGroups.length; g++) blockGroups[g]!.applied = pending.at(g);
      } finally {
        pending.clear();
        changes.clear();
        setActiveSub(outer);
      }
    },
  };
}

/** File every change as is: for a caller that then rebuilds from the rows' filed results. */
export function fileAll<T, O, K>(changes: Scratch<Change<T, O, K>>): void {
  for (let i = 0; i < changes.size; i++) {
    const change = changes.at(i);
    change[0].applied = change[1]; // eslint-disable-line prefer-destructuring -- destructuring walks an iterator
  }
}
