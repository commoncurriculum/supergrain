import { batch } from "./batch";
import { unwrap } from "./core";
import { deleteProperty, setProperty } from "./write";

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
 *
 * @example
 * ```ts
 * const state = createReactive({ user: { name: "Ada", visits: 1 } });
 * reconcile(state.user, { name: "Ada", visits: 2 }); // only `visits` notifies
 * ```
 */
export function reconcile<T>(previous: T, next: T): T {
  const target = unwrap(previous);
  const value = unwrap(next);
  if (target === value || !sameShape(target, value)) return next;
  batch(() =>
    update(target as Record<PropertyKey, unknown>, value as Record<PropertyKey, unknown>),
  );
  return previous;
}

// Works on the raw objects: reads never subscribe the running effect, and
// `setProperty` / `deleteProperty` notify exactly as a write through the proxy.
function update(target: Record<PropertyKey, unknown>, next: Record<PropertyKey, unknown>): void {
  if (Array.isArray(target)) {
    const items = next as unknown as Array<unknown>;
    const previousById = byId(target, items);
    items.forEach((item, index) =>
      write(target, index, previousById ? previousById.get(idOf(item)) : target[index], item),
    );
    if (target.length > items.length) setProperty(target, "length", items.length);
    return;
  }
  for (const key of Object.keys(next)) write(target, key, target[key], next[key]);
  for (const key of Object.keys(target)) if (!Object.hasOwn(next, key)) deleteProperty(target, key);
}

// Store `next` at `target[key]`, reusing `previous` when the two can be reconciled.
function write(
  target: Record<PropertyKey, unknown>,
  key: PropertyKey,
  previous: unknown,
  next: unknown,
): void {
  const value = unwrap(next);
  if (sameShape(unwrap(previous), value)) {
    update(unwrap(previous) as Record<PropertyKey, unknown>, value as Record<PropertyKey, unknown>);
    if (unwrap(target[key]) !== unwrap(previous)) setProperty(target, key, previous);
  } else if (!Object.hasOwn(target, key) || unwrap(target[key]) !== value) {
    setProperty(target, key, next);
  }
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

// The previous items keyed by `id`, or undefined when either array has an item
// without a string or number `id`, or a repeated one.
function byId(previous: Array<unknown>, next: Array<unknown>): Map<unknown, unknown> | undefined {
  const previousById = new Map(previous.map((item) => [idOf(item), item]));
  const nextIds = new Set(next.map(idOf));
  const unique =
    previousById.size === previous.length &&
    nextIds.size === next.length &&
    !previousById.has(undefined) &&
    !nextIds.has(undefined);
  return unique ? previousById : undefined;
}

function idOf(item: unknown): string | number | undefined {
  const raw = unwrap(item);
  if (shapeOf(raw) !== "object") return undefined;
  const { id } = raw as { id?: unknown };
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}
