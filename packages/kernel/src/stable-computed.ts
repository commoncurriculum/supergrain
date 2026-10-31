import { computed } from "alien-signals";

import { createReactive } from "./store";
import { syncArray } from "./sync-array";

/**
 * A memoized derived **array** with a stable reference.
 *
 * A plain `computed` that returns `xs.filter(...).map(...)` hands back a
 * **fresh array** every time it re-runs, so its reference churns on every
 * change. `stableComputed` keeps **one** persistent reactive array and
 * reconciles it in place to match the getter's result, so:
 *
 * - the returned **reference never changes** — `use()`, `<For>`, and
 *   dependency arrays don't churn across recomputes;
 * - reads stay **fine-grained** — only the array slots that actually changed
 *   notify (the reconcile drives the array's own per-index signals);
 * - it still **firewalls** — because it returns the same reference, a re-run
 *   that produces an equal list doesn't propagate to subscribers.
 *
 * The getter must return an array whose transform preserves order (`map` /
 * `filter`): the in-place reconcile is index-based, so a reordering transform
 * like `sort` rewrites every shifted slot rather than moving it.
 *
 * Unlike `computed`, the getter takes no `previousValue`: the returned value IS
 * the persistent reconcile target, so a `previousValue` would be that target —
 * reading it inside the getter would subscribe the computed to the array it is
 * about to reconcile (a self-cycle). The value is produced fresh each run.
 */
export function stableComputed<T extends ReadonlyArray<unknown>>(getter: () => T): () => T {
  // One persistent reactive array, reconciled in place on every run. Created up
  // front (an empty reactive array is cheap) so the getter body stays a plain
  // reconcile. Cast the brand away (as `createReactive` callers do) so it
  // reads/writes as a plain array.
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
