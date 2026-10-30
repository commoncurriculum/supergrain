import { unwrap } from "./core";

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
export function syncArray(target: Array<unknown>, next: ReadonlyArray<unknown>): void {
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
