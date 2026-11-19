import { isMissing } from "./compare";
import { createIndex } from "./index-rows";
import { OUTSIDE } from "./row-blocks";

/** A collection's docs by key, for looking docs up inside query steps. */
export interface Lookup<K, V> {
  /**
   * The first doc with this key, or `undefined`. Read reactively: a reader
   * reruns only when the doc under this key changes (another object, or
   * none), not when other keys do.
   */
  get(key: K | null | undefined): V | undefined;
  /**
   * Every doc with this key, in source order (one-to-many: all tasks for a
   * user). The same reactive array for a key every time, updated in place,
   * so a reader that reads its items reruns only when this key's docs change.
   */
  getAll(key: K | null | undefined): ReadonlyArray<V>;
}

/** A {@link Lookup} as the list that owns it sees it. */
export interface SyncedLookup<K, V> extends Lookup<K, V> {
  /**
   * Bring every looked-up key up to date with the source, and subscribe the
   * caller to the source. A list calls this before reading its rows, so a
   * change to the source wakes only the rows whose key's docs changed.
   */
  sync(): void;
}

/** `getAll` of a missing key: never changes, so shared. */
const NONE: ReadonlyArray<never> = Object.freeze([]);

/**
 * A reactive index from key to docs over a collection (see `index-rows.ts`).
 *
 * Keys are compared like `Map` keys. `null`, `undefined` and `NaN` never
 * match. When two docs share a key, `get` finds the first in the source, and
 * `getAll` lists them in source order.
 */
export function createLookup<V extends object, K>(
  source: () => Iterable<V>,
  key: (doc: V) => K,
): SyncedLookup<K, V> {
  const index = createIndex<V, V, K>(source, (doc, previous) => {
    const k = key(doc);
    if (isMissing(k)) return OUTSIDE;
    return previous?.member && previous.key === k ? previous : { member: true, value: doc, key: k };
  });
  return {
    sync: index.sync,
    get: (k) => (isMissing(k) ? undefined : index.first(k as K)),
    getAll: (k) => (isMissing(k) ? NONE : index.all(k as K)),
  };
}
