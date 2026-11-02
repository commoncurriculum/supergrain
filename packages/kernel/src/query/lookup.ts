import { signal } from "alien-signals";

import { untracked } from "../core";
import { rethrowingComputed } from "../rethrowing-computed";
import { isMissing } from "./compare";
import { forEachItem } from "./for-each-item";

/** A collection's docs by key, for looking docs up inside query steps. */
export interface Lookup<K, V> {
  /**
   * The doc with this key, or `undefined`. Read reactively: a reader reruns
   * only when the doc under this key changes (another object, or none), not
   * when other keys do.
   */
  get(key: K | null | undefined): V | undefined;
}

/** A {@link Lookup} as the list that owns it sees it. */
export interface SyncedLookup<K, V> extends Lookup<K, V> {
  /**
   * Bring every looked-up key up to date with the source, and subscribe the
   * caller to the source. A list calls this before reading its rows, so a
   * change to the source wakes only the rows whose key now finds another doc.
   */
  sync(): void;
}

/**
 * A reactive map from key to doc over a collection.
 *
 * Keys are compared like `Map` keys. `null`, `undefined` and `NaN` never
 * match. When two docs share a key, the first in the source wins.
 *
 * The map is rebuilt when the source's structure changes, or when a key a
 * doc returned changes. That's one walk of the source. Each key that has been
 * looked up has its own signal, written only when the doc under that key
 * changes. Readers subscribe to that signal alone, never to the map, so one
 * change to the source doesn't mark every reader for a recheck.
 */
export function createLookup<V extends object, K>(
  source: () => Iterable<V>,
  key: (doc: V) => K,
): SyncedLookup<K, V> {
  // One signal per key ever looked up. Never deleted: a reader may still
  // hold one. A lookup over keys that keep changing grows slowly.
  const slots = new Map<K, (value?: V) => V | undefined>();
  let synced: Map<K, V> | undefined = undefined;
  const entries = rethrowingComputed((): Map<K, V> => {
    const map = new Map<K, V>();
    forEachItem(source(), (doc) => {
      const k = key(doc);
      if (!isMissing(k) && !map.has(k)) map.set(k, doc);
    });
    return map;
  });

  /** The signal holding the doc under `k`, made on first use. */
  function slotOf(k: K): (value?: V) => V | undefined {
    // Untracked: the reader subscribes to its key's slot, not to the map.
    untracked(sync);
    let slot = slots.get(k);
    if (slot === undefined) {
      slot = signal<V | undefined>(synced!.get(k)) as (value?: V) => V | undefined;
      slots.set(k, slot);
    }
    return slot;
  }

  function sync(): void {
    const map = entries();
    if (map === synced) return;
    synced = map;
    // A slot stays for as long as the lookup does: a reader may be
    // subscribed to it even while no doc has its key.
    for (const [k, slot] of slots) {
      const doc = map.get(k);
      if (untracked(slot) !== doc) slot(doc);
    }
  }

  return {
    sync,
    get: (k) => (isMissing(k) ? undefined : slotOf(k as K)()),
  };
}
