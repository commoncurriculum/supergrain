import type { InternalHandle } from "./transitions";

import { createReactive, unwrap } from "@supergrain/kernel";
import { setActiveSub } from "@supergrain/kernel/internal";

interface LoadedList {
  /** The reactive list handed out: each loaded doc once, in first-load order. */
  readonly docs: Array<object>;
  /** Each doc's place in `docs`, by id. */
  readonly at: Map<string, number>;
}

/**
 * The loaded documents of each type, as one reactive array per type. A type's
 * list is built the first time it's asked for and kept up to date from then
 * on, so types nobody lists cost nothing.
 *
 * The list only grows (a doc loads), swaps an entry (a "replace" refetch gives
 * the doc a new object) or empties (clearMemory). Each is one write to a store
 * array, so a `computedList` over it follows the change instead of rescanning.
 */
export function createLoadedLists(
  bucketOf: (type: string) => Map<string, InternalHandle> | undefined,
) {
  const lists = new Map<string, LoadedList>();

  return {
    /** The list for `type`, built from what's already loaded on first call. */
    get(type: string): ReadonlyArray<object> {
      let list = lists.get(type);
      if (!list) {
        const raw: Array<object> = [];
        const at = new Map<string, number>();
        for (const [id, handle] of bucketOf(type) ?? []) {
          const value = unwrap(handle).value as object | undefined;
          if (value !== undefined) {
            at.set(id, raw.length);
            raw.push(value);
          }
        }
        list = { docs: createReactive(raw), at };
        lists.set(type, list);
      }
      return list.docs;
    },

    /**
     * Record that the doc under `id` went from `before` to `after` (raw
     * values). Untracked: a scope that inserts doesn't subscribe to the list.
     */
    changed(type: string, id: string, before: unknown, after: unknown): void {
      const list = lists.get(type);
      if (!list || before === after || after === undefined) return;
      const { docs, at } = list;
      const index = at.get(id);
      const outer = setActiveSub(undefined);
      try {
        if (index === undefined) {
          at.set(id, docs.length);
          docs.push(after as object);
        } else {
          docs[index] = after as object;
        }
      } finally {
        setActiveSub(outer);
      }
    },

    /** Empty every list, keeping each array so its readers stay connected. */
    clear(): void {
      const outer = setActiveSub(undefined);
      try {
        for (const { docs, at } of lists.values()) {
          at.clear();
          docs.length = 0;
        }
      } finally {
        setActiveSub(outer);
      }
    },
  };
}
