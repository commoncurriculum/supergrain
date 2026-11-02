/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { catchingComputed, rethrowingComputed } from "../rethrowing-computed";
import { OUTSIDE, type Change, type RowResult } from "./row-blocks";
import { Scratch } from "./scratch";
import { createSourceRows, type Structure } from "./source-rows";

/**
 * The source's rows, each run in its own computed, and the rows whose
 * result changed since it was last filed. Both the list and the lookup
 * index are built on this: each reads the changes, files them in its own
 * structure, and commits.
 *
 * One update is three calls:
 *
 * 1. `read()`, tracked: the source's structure and each group's changes.
 * 2. `collect(next)`, untracked: the changes not yet filed, into `changes`.
 *    The caller files each one (sets `row.applied`) as it moves the row.
 * 3. `commit(next)`, once nothing threw: record what was filed.
 *
 * Then `clear()`, in a `finally`, whether the update threw or not.
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

  return {
    changes,

    /** Tracked: the source's structure, and each group's changes. */
    read(): Structure<T, O, K> {
      const next = structure();
      const { groups } = next;
      for (let g = 0; g < groups.length; g++) pending.push(groups[g]!.changes());
      return next;
    },

    /**
     * Put the changes not yet filed in `changes`: rows that left while
     * filed as members, then each group's unfiled changes. A failed update
     * may have filed some already.
     */
    collect(next: Structure<T, O, K>): Scratch<Change<T, O, K>> {
      const { removed, groups } = next;
      for (let i = 0; i < removed.length; i++) {
        if (removed[i]!.applied.member) changes.push([removed[i]!, OUTSIDE]);
      }
      for (let g = 0; g < groups.length; g++) {
        const groupChanges = pending.at(g);
        if (groupChanges !== groups[g]!.applied) {
          for (let i = 0; i < groupChanges.length; i++) {
            const change = groupChanges[i]!;
            if (change[0].applied !== change[1]) changes.push(change);
          }
        }
      }
      return changes;
    },

    /** Nothing threw: record which changes each group's rows now reflect. */
    commit(next: Structure<T, O, K>): void {
      const { groups } = next;
      for (let g = 0; g < groups.length; g++) groups[g]!.applied = pending.at(g);
    },

    clear(): void {
      pending.clear();
      changes.clear();
    },
  };
}
