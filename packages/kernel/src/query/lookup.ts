import { isMissing } from "./compare";
import { createIndex } from "./index-rows";
import { OUTSIDE } from "./row-blocks";

/** A collection's docs by key, for looking docs up inside query steps. */
export interface Lookup<K, V> {
  /** The first doc with this key, or `undefined`. Reruns only when this key's doc changes. */
  get(key: K | null | undefined): V | undefined;
  /** Every doc with this key, in source order: the same array per key, updated in place. */
  getAll(key: K | null | undefined): ReadonlyArray<V>;
}

export interface SyncedLookup<K, V> extends Lookup<K, V> {
  // Must run before the owning list reads its rows.
  sync(): void;
}

const NONE: ReadonlyArray<never> = Object.freeze([]);

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
