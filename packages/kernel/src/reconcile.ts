import { batch } from "./batch";
import { unwrap } from "./core";
import { createReactiveProxy } from "./read";

/**
 * Bring `previous` in line with `next` by writing only what changed, and return
 * the value to keep.
 *
 * When `previous` and `next` are both plain objects, or both arrays, `previous`
 * is updated in place and returned: a subscriber re-runs only when a field it
 * reads changed, and the object's identity never changes. Otherwise (a first
 * value, a primitive, a `Date`, a `Map`, or a change of shape) `next` is
 * returned for the caller to store.
 *
 * - Fields missing from `next` are deleted.
 * - Arrays whose items all carry a unique string or number `id` are matched by
 *   `id`, so a moved item keeps its object. Other arrays are matched by index.
 * - `next` must be acyclic, like any fetched JSON.
 * - Objects reached from `previous` are written into, so they must belong to
 *   the caller. That is why `stableComputed` keeps its own index-only sync:
 *   its items belong to another store.
 *
 * @example
 * ```ts
 * const state = createReactive({ user: { name: "Ada", visits: 1 } });
 * reconcile(state.user, { name: "Ada", visits: 2 }); // only `visits` notifies
 * ```
 */
export function reconcile<T>(previous: T, next: T): T {
  const previousRaw = unwrap(previous);
  const nextRaw = unwrap(next);
  if (previousRaw === nextRaw || !sameShape(previousRaw, nextRaw)) return next;
  batch(() => reconcileInto(previousRaw as object, nextRaw as object));
  return previous;
}

function shapeOf(value: unknown): "array" | "object" | undefined {
  if (Array.isArray(value)) return "array";
  if (value === null || typeof value !== "object") return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? "object" : undefined;
}

function sameShape(previous: unknown, next: unknown): boolean {
  const shape = shapeOf(previous);
  return shape !== undefined && shape === shapeOf(next);
}

// Reads go to the raw target and writes through its proxy, so the writes notify
// subscribers while the reads never subscribe whoever is running.
function reconcileInto(raw: object, next: object): void {
  if (Array.isArray(raw)) {
    reconcileArray(raw, next as Array<unknown>, createReactiveProxy(raw));
    return;
  }
  const record = raw as Record<string, unknown>;
  const proxy = createReactiveProxy(record);
  const nextRecord = next as Record<string, unknown>;
  for (const key of Object.keys(nextRecord)) reconcileSlot(record, key, nextRecord[key], proxy);
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(nextRecord, key)) delete proxy[key];
  }
}

function reconcileSlot(
  raw: Record<PropertyKey, unknown>,
  key: PropertyKey,
  next: unknown,
  proxy: Record<PropertyKey, unknown>,
): void {
  const previous = unwrap(raw[key]);
  const nextRaw = unwrap(next);
  if (previous === nextRaw && Object.hasOwn(raw, key)) return;
  if (sameShape(previous, nextRaw)) reconcileInto(previous as object, nextRaw as object);
  else proxy[key] = next;
}

function reconcileArray(
  raw: Array<unknown>,
  next: ReadonlyArray<unknown>,
  proxy: Array<unknown>,
): void {
  const previousById = indexById(raw, next);
  for (let index = 0; index < next.length; index++) {
    const match = previousById?.get(idOf(next[index]));
    if (previousById === undefined) {
      reconcileSlot(
        raw as unknown as Record<PropertyKey, unknown>,
        index,
        next[index],
        proxy as unknown as Record<PropertyKey, unknown>,
      );
    } else if (match === undefined) {
      proxy[index] = next[index];
    } else {
      reconcileInto(match, unwrap(next[index]) as object);
      if (unwrap(raw[index]) !== match) proxy[index] = match;
    }
  }
  if (raw.length > next.length) proxy.length = next.length;
}

// The previous items keyed by `id`, or undefined when the arrays can't be
// matched that way: an item without a string or number `id`, or a repeated one.
function indexById(
  raw: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
): Map<unknown, object> | undefined {
  const previousById = new Map<unknown, object>();
  for (const item of raw) {
    const id = idOf(item);
    if (id === undefined || previousById.has(id)) return undefined;
    previousById.set(id, unwrap(item) as object);
  }
  const nextIds = new Set<unknown>();
  for (const item of next) {
    const id = idOf(item);
    if (id === undefined || nextIds.has(id)) return undefined;
    nextIds.add(id);
  }
  return previousById;
}

function idOf(item: unknown): string | number | undefined {
  const raw = unwrap(item);
  if (shapeOf(raw) !== "object") return undefined;
  const { id } = raw as { id?: unknown };
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}
