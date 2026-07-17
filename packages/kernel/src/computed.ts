import { computed as alienComputed } from "alien-signals";

import { unwrap } from "./core";
import { createReactive } from "./store";

/**
 * Options for {@link computed}.
 */
export interface ComputedOptions {
  /**
   * Return a **stable reference** instead of whatever the getter returns.
   *
   * A plain `computed` that returns `xs.filter(...).map(...)` hands back a
   * **fresh array** every time it re-runs, so its reference churns on every
   * change. With `returnStableReference`, the computed keeps **one** persistent
   * reactive array and reconciles it in place to match the getter's result, so:
   *
   * - the returned **reference never changes** — `use()`, `<For>`, and
   *   dependency arrays don't churn across recomputes;
   * - reads stay **fine-grained** — only the array slots that actually changed
   *   notify (the reconcile drives the array's own per-index signals);
   * - the computed still **firewalls** — because it returns the same reference,
   *   a re-run that produces an equal list doesn't propagate to subscribers.
   *
   * The getter must return an array. (Reconcile is index-based, which is
   * correct and minimal for order-preserving transforms like `map` / `filter`;
   * a reordering transform such as `sort` would need keyed move-detection,
   * which is not yet supported.)
   */
  returnStableReference?: boolean;
}

/**
 * A memoized derived value. Wraps alien-signals' `computed`; with no options it
 * IS that computed (same identity, same hot path). Passing
 * `{ returnStableReference: true }` opts into a stable-reference array (see
 * {@link ComputedOptions.returnStableReference}).
 */
export function computed<T>(getter: (previousValue?: T) => T): () => T;
export function computed<T extends ReadonlyArray<unknown>>(
  getter: (previousValue?: T) => T,
  options: ComputedOptions,
): () => T;
export function computed<T>(getter: (previousValue?: T) => T, options?: ComputedOptions): () => T {
  // No options → return the raw alien-signals computed untouched. The
  // stable-reference machinery below never runs, so the common (and
  // benchmark-hot) path pays nothing.
  if (!options?.returnStableReference) {
    return alienComputed(getter);
  }

  // One persistent reactive array, reconciled in place on every run. Created up
  // front (an empty reactive array is cheap) so the getter body stays a plain
  // reconcile. Cast the brand away (as `createReactive` callers do) so it
  // reads/writes as a plain array.
  const target = createReactive<Array<unknown>>([]) as Array<unknown>;
  return alienComputed(() => {
    const next = getter();
    if (!Array.isArray(next)) {
      throw new TypeError(
        "@supergrain/kernel: computed(getter, { returnStableReference: true }) requires the getter to return an array.",
      );
    }
    syncArray(target, next);
    return target as unknown as T;
  }) as () => T;
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
 * Index-based, so it is correct and minimal for order-preserving producers
 * (`map` / `filter`): the set of slots it writes is exactly `{ i : old[i] !==
 * next[i] }`, which for two same-ordered arrays is the true diff. A reordering
 * producer (`sort`) would rewrite every shifted slot; keyed move-detection
 * would be the extension for that case.
 */
function syncArray(target: Array<unknown>, next: ReadonlyArray<unknown>): void {
  const raw = unwrap(target) as Array<unknown>;
  for (let i = 0; i < next.length; i++) {
    if (unwrap(raw[i]) !== unwrap(next[i])) target[i] = next[i];
  }
  if (raw.length > next.length) {
    target.length = next.length;
  }
}
