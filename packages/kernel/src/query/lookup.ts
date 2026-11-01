import { rethrowingComputed } from "../rethrowing-computed";
import { isMissing } from "./compare";
import { forEachItem } from "./list";

/** A collection's docs by key, for looking docs up inside query steps. */
export interface Lookup<K, V> {
  /**
   * The doc with this key, or `undefined`. Read reactively: a reader reruns
   * only when the doc under this key changes (another object, or none), not
   * when other keys do.
   */
  get(key: K | null | undefined): V | undefined;
}

/**
 * A reactive map from key to doc over a collection.
 *
 * Keys are compared like `Map` keys. `null`, `undefined` and `NaN` never
 * match. When two docs share a key, the first in the source wins.
 *
 * The map is rebuilt when the source's structure changes, or when a key a
 * doc returned changes. That's one walk of the source. Each key that has been
 * looked up has its own computed over the map, so a rebuild wakes only the
 * readers whose key now finds another doc.
 */
export function createLookup<V extends object, K>(
  source: () => Iterable<V>,
  key: (doc: V) => K,
): Lookup<K, V> {
  const lookups = new Map<K, () => V | undefined>();
  const entries = rethrowingComputed((): Map<K, V> => {
    const map = new Map<K, V>();
    forEachItem(source(), (doc) => {
      const k = key(doc);
      if (!isMissing(k) && !map.has(k)) map.set(k, doc);
    });
    // Forget lookups for keys that are gone. A reader still subscribed to a
    // forgotten one keeps working: it still reads the map, and looks the key
    // up again (making a new lookup) when the map changes.
    if (lookups.size > 2 * map.size + 64) {
      for (const k of lookups.keys()) if (!map.has(k)) lookups.delete(k);
    }
    return map;
  });
  return {
    get: (k) => (isMissing(k) ? undefined : lookupOf(k as K)()),
  };

  function lookupOf(k: K): () => V | undefined {
    let lookup = lookups.get(k);
    if (lookup === undefined) {
      lookup = rethrowingComputed(() => entries().get(k));
      lookups.set(k, lookup);
    }
    return lookup;
  }
}
