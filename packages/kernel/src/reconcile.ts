import { batch } from "./batch";
import { isWrappable, unwrap } from "./core";
import { deleteProperty, setProperty } from "./write";

/**
 * Bring `previous` in line with `next` by writing only what changed, and return
 * the value to keep. This is Solid's `reconcile` with `key: "id"`, on the
 * kernel's own write functions.
 *
 * When `previous` and `next` are both objects or both arrays, `previous` is
 * updated in place and returned, so a subscriber re-runs only when a field it
 * reads changed. Otherwise `next` is returned for the caller to store.
 *
 * - Fields missing from `next` are deleted.
 * - Array items with the same `id` keep their object, wherever they move.
 * - An object whose `id` changed is replaced, not written into.
 *
 * @example
 * ```ts
 * const state = createReactive({ user: { name: "Ada", visits: 1 } });
 * reconcile(state.user, { name: "Ada", visits: 2 }); // only `visits` notifies
 * ```
 */
export function reconcile<T>(previous: T, next: T): T {
  const root: Record<PropertyKey, unknown> = { value: unwrap(previous) };
  batch(() => applyState(unwrap(next), root, "value"));
  return root["value"] === unwrap(previous) ? previous : next;
}

type Container = Record<PropertyKey, unknown>;

// Solid's `applyState`. It reads the raw objects, so no read subscribes the
// running effect, and writes with `setProperty` / `deleteProperty`, the
// functions the proxy's traps call, so subscribers are notified as for any write.
function applyState(target: unknown, parent: Container, property: PropertyKey): void {
  const previous = unwrap(parent[property]);
  if (target === previous) return;
  if (
    !isContainer(target) ||
    !isContainer(previous) ||
    Array.isArray(target) !== Array.isArray(previous) ||
    target["id"] !== previous["id"]
  ) {
    setProperty(parent, property, target);
    return;
  }
  if (Array.isArray(target)) {
    applyArray(target, previous as unknown as Array<unknown>);
    return;
  }
  for (const key of Object.keys(target)) applyState(target[key], previous, key);
  for (const key of Object.keys(previous)) {
    if (!Object.hasOwn(target, key)) deleteProperty(previous, key);
  }
}

// Solid's array pass: skip the common prefix and suffix, then move each
// remaining previous item to the index of the next item with its `id`.
function applyArray(target: Array<unknown>, previous: Array<unknown>): void {
  const parent = previous as unknown as Container;
  if (target.length === 0 || previous.length === 0) {
    target.forEach((item, index) => applyState(item, parent, index));
    if (previous.length > target.length) setProperty(previous, "length", target.length);
    return;
  }

  let start = 0;
  const shortest = Math.min(previous.length, target.length);
  while (start < shortest && sameItem(previous[start], target[start])) {
    applyState(target[start], parent, start);
    start++;
  }

  const moved: Array<unknown> = Array.from({ length: target.length });
  const placed = new Set<number>();
  let end = previous.length - 1;
  let newEnd = target.length - 1;
  while (end >= start && newEnd >= start && sameItem(previous[end], target[newEnd])) {
    moved[newEnd] = previous[end];
    placed.add(newEnd);
    end--;
    newEnd--;
  }

  if (start > newEnd || start > end) {
    for (let index = start; index <= newEnd; index++) setProperty(previous, index, target[index]);
    for (let index = newEnd + 1; index < target.length; index++) {
      setProperty(previous, index, moved[index]);
      applyState(target[index], parent, index);
    }
    if (previous.length > target.length) setProperty(previous, "length", target.length);
    return;
  }

  // For each id, the first index in `target[start..newEnd]` that wants it, with
  // `nextIndexWithKey` chaining to the following index that wants the same id.
  const firstIndexWithKey = new Map<unknown, number>();
  const nextIndexWithKey: Array<number> = [];
  for (let index = newEnd; index >= start; index--) {
    const key = keyOf(target[index]);
    nextIndexWithKey[index] = firstIndexWithKey.get(key) ?? -1;
    firstIndexWithKey.set(key, index);
  }
  for (let index = start; index <= end; index++) {
    const key = keyOf(previous[index]);
    const wanted = firstIndexWithKey.get(key);
    if (wanted !== undefined && wanted !== -1) {
      moved[wanted] = previous[index];
      placed.add(wanted);
      firstIndexWithKey.set(key, nextIndexWithKey[wanted]!);
    }
  }
  for (let index = start; index < target.length; index++) {
    if (placed.has(index)) {
      setProperty(previous, index, moved[index]);
      applyState(target[index], parent, index);
    } else {
      setProperty(previous, index, target[index]);
    }
  }
  if (previous.length > target.length) setProperty(previous, "length", target.length);
}

// What Solid wraps: plain objects and arrays. The kernel also wraps Maps and
// Sets, which have no fields to diff, so those are replaced whole.
function isContainer(value: unknown): value is Container {
  return isWrappable(value) && !(value instanceof Map) && !(value instanceof Set);
}

function keyOf(item: unknown): unknown {
  const raw = unwrap(item);
  return raw && typeof raw === "object" ? (raw as Container)["id"] : undefined;
}

function sameItem(previous: unknown, next: unknown): boolean {
  const key = keyOf(previous);
  return unwrap(previous) === next || (key !== undefined && key !== null && key === keyOf(next));
}
