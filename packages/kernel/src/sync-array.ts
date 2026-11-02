/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { unwrap } from "./core";

/**
 * Reconcile reactive `target` to equal plain `next` (its first `length`
 * items), mutating in place.
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
export function syncArray(
  target: Array<unknown>,
  next: ReadonlyArray<unknown>,
  length = next.length,
): void {
  const raw = unwrap(target) as Array<unknown>;
  for (let i = 0; i < length; i++) {
    // Always assign past-the-end slots, even when both sides read `undefined`:
    // a trailing `undefined` element must become an own slot that extends
    // `length` (never a hole, which `map`/`forEach` would skip).
    if (i >= raw.length || unwrap(raw[i]) !== unwrap(next[i])) target[i] = next[i];
  }
  if (raw.length > length) {
    target.length = length;
  }
}

/**
 * Make reactive `target` equal plain `next` (its first `nextLength` items)
 * with one `splice`: the items both start with and end with stay, and the
 * ones between are replaced. A row added or removed in the middle is then
 * one splice in the array's log, which a query following `target` applies
 * without a walk. With `syncArray`, it would be a write per shifted slot.
 *
 * `current` holds what `target` holds now, in the same form as `next` (the
 * raw target itself when `next` holds raw values), so the two are compared
 * by identity, with no proxy reads.
 *
 * Unlike `syncArray`, `splice` reads `target` through the proxy: call it
 * untracked, or the caller subscribes to `target`.
 */
export function spliceArray(
  target: Array<unknown>,
  current: ReadonlyArray<unknown>,
  currentLength: number,
  next: ReadonlyArray<unknown>,
  nextLength: number,
): void {
  const shortest = Math.min(currentLength, nextLength);
  let start = 0;
  while (start < shortest && current[start] === next[start]) start++;
  let oldEnd = currentLength;
  let newEnd = nextLength;
  while (oldEnd > start && newEnd > start && current[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const removed = oldEnd - start;
  const added = newEnd - start;
  // Items go in raw, as an index write would store them: `splice` through
  // the proxy stores what it's given. The common cases need no array of
  // arguments.
  if (added === 0) {
    if (removed > 0) target.splice(start, removed);
  } else if (added === 1) {
    target.splice(start, removed, unwrap(next[start]));
  } else if (added <= 1024) {
    const items = next.slice(start, newEnd);
    for (let i = 0; i < items.length; i++) items[i] = unwrap(items[i]);
    target.splice(start, removed, ...items);
  } else {
    // Spreading more would overflow the call stack: rebuild the tail.
    const tail = (unwrap(target) as Array<unknown>).slice(oldEnd);
    target.length = start;
    for (let i = start; i < newEnd; i++) target.push(unwrap(next[i]));
    for (let i = 0; i < tail.length; i++) target.push(tail[i]);
  }
}
