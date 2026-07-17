import { computed } from "alien-signals";

import { unwrap } from "./core";
import { createReactive } from "./store";

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

/**
 * Reconcile reactive `target` to equal plain `next`, mutating in place.
 *
 * `set`-only: index assignment and a `length` truncation, never a proxy `get`,
 * so calling this inside a `computed` never subscribes that computed to
 * `target` (no self-cycle). The kernel's write path already fires a per-index
 * signal only when `unwrap(old) !== unwrap(new)`, so unchanged slots stay
 * quiet; the pre-check here just avoids touching the proxy for a no-op.
 *
 * Index-based, so correct and minimal for order-preserving producers (`map` /
 * `filter`): the slots it writes are exactly `{ i : old[i] !== next[i] }`, the
 * true diff for two same-ordered arrays. A reordering producer (`sort`) rewrites
 * every shifted slot.
 */
function syncArray(target: Array<unknown>, next: ReadonlyArray<unknown>): void {
  const raw = unwrap(target) as Array<unknown>;
  for (let i = 0; i < next.length; i++) {
    // Always assign past-the-end slots, even when both sides read `undefined`:
    // a trailing `undefined` element must become an own slot that extends
    // `length` (never a hole, which `map`/`forEach` would skip).
    if (i >= raw.length || unwrap(raw[i]) !== unwrap(next[i])) target[i] = next[i];
  }
  if (raw.length > next.length) {
    target.length = next.length;
  }
}
