import { computed } from "./computed";
import { createReactive } from "./store";
import { syncArray } from "./sync-array";

/**
 * A derived array with a stable reference: one reactive array, reconciled in
 * place on each run, so only changed slots notify.
 *
 * Reconciling is index-based: a reordering getter (e.g. `sort`) rewrites every
 * shifted slot. The getter gets no previous value.
 */
export function stableComputed<T extends ReadonlyArray<unknown>>(getter: () => T): () => T {
  const target = createReactive<Array<unknown>>([]) as Array<unknown>;
  return computed((): T => {
    const next = getter();
    if (!Array.isArray(next)) {
      throw new TypeError(
        "@supergrain/kernel: stableComputed requires the getter to return an array.",
      );
    }
    syncArray(target, next);
    return target as unknown as T;
  });
}
