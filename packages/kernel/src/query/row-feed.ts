/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { setActiveSub } from "alien-signals";

import { catchingComputed, rethrowingComputed } from "../rethrowing-computed";
import { OUTSIDE, type Change, type RowResult } from "./row-blocks";
import { Scratch } from "./scratch";
import { createSourceRows, type Structure } from "./source-rows";

// Protocol: `read()` tracked, then `apply(next, file)`. `file` must set
// `row.applied` on each change it files; if it throws, the unfiled changes
// come back on the next update.
export function createRowFeed<T extends object, O, K>(
  source: () => Iterable<T>,
  run: (item: T, previous: RowResult<O, K> | undefined) => RowResult<O, K>,
) {
  const resultOf = (item: T) =>
    catchingComputed((previous: RowResult<O, K> | undefined) => run(item, previous));
  const structure = rethrowingComputed(createSourceRows<T, O, K>(source, resultOf));
  const pending = new Scratch<ReadonlyArray<Change<T, O, K>>>();
  const changes = new Scratch<Change<T, O, K>>();

  function collect(next: Structure<T, O, K>): void {
    const { removed, blockGroups } = next;
    for (let i = 0; i < removed.length; i++) {
      if (removed[i]!.applied.member) changes.push({ row: removed[i]!, next: OUTSIDE });
    }
    for (let g = 0; g < blockGroups.length; g++) {
      const groupChanges = pending.at(g);
      if (groupChanges !== blockGroups[g]!.applied) {
        for (let i = 0; i < groupChanges.length; i++) {
          const change = groupChanges[i]!;
          // A failed update may have filed some already.
          if (change.row.applied !== change.next) changes.push(change);
        }
      }
    }
  }

  return {
    read(): Structure<T, O, K> {
      // An update that threw before `apply` left entries here.
      pending.clear();
      const next = structure();
      const { blockGroups } = next;
      for (let g = 0; g < blockGroups.length; g++) pending.push(blockGroups[g]!.changes());
      return next;
    },

    // Call after every successful `read`.
    apply(
      next: Structure<T, O, K>,
      file: (changes: Scratch<Change<T, O, K>>, next: Structure<T, O, K>) => void,
    ): void {
      const outer = setActiveSub(undefined);
      try {
        collect(next);
        file(changes, next);
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

export function fileAll<T, O, K>(changes: Scratch<Change<T, O, K>>): void {
  for (let i = 0; i < changes.size; i++) {
    const { row, next } = changes.at(i);
    row.applied = next;
  }
}
