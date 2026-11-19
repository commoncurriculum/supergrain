/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { unwrap } from "./core";

// Never reads `target` through the proxy, so calling it inside a computed
// doesn't subscribe that computed to `target`.
export function syncArray(target: Array<unknown>, next: ReadonlyArray<unknown>): void {
  const raw = unwrap(target) as Array<unknown>;
  const { length } = next;
  for (let i = 0; i < length; i++) {
    // Past the end, assign even `undefined`: a hole would be skipped by map/forEach.
    if (i >= raw.length || unwrap(raw[i]) !== unwrap(next[i])) target[i] = next[i];
  }
  if (raw.length > length) {
    target.length = length;
  }
}

// `splice` reads `target` through the proxy: call untracked, or the caller
// subscribes to `target`.
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
  // Unwrap: `splice` through the proxy stores exactly what it's given.
  if (added === 0) {
    if (removed > 0) target.splice(start, removed);
  } else if (added === 1) {
    target.splice(start, removed, unwrap(next[start]));
  } else if (added <= 1024) {
    const items = next.slice(start, newEnd);
    for (let i = 0; i < items.length; i++) items[i] = unwrap(items[i]);
    target.splice(start, removed, ...items);
  } else {
    // Spreading more arguments risks a call-stack overflow.
    const tail = (unwrap(target) as Array<unknown>).slice(oldEnd);
    target.length = start;
    for (let i = start; i < newEnd; i++) target.push(unwrap(next[i]));
    for (let i = 0; i < tail.length; i++) target.push(tail[i]);
  }
}
