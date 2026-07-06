/**
 * Shared, dependency-free helpers used across mill's path navigation, query
 * matching, and operator implementations. Kept in their own module so `path.ts`
 * and `query.ts` can both use them without an import cycle through
 * `operators.ts`.
 */

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isContainer(value: unknown): value is Record<string, unknown> | Array<unknown> {
  return value !== null && typeof value === "object";
}

export function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * Deep structural equality. Mirrors MongoDB's value comparison closely enough
 * for the operators that need it (`$pull`, `$pullAll`, `$addToSet`, and the
 * query matcher): primitives compare by `===`, objects/arrays compare by their
 * own enumerable keys.
 */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }

  // Dates have no enumerable own keys, so compare by time rather than falling
  // through to the structural key check (which would treat all Dates as equal).
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);

  if (keysA.length !== keysB.length) {
    return false;
  }

  // Use a Set for keysB to avoid quadratic time on large objects, but only when
  // it actually pays off — benchmarking puts the crossover around 50 keys.
  const keysBSet = keysB.length >= 50 ? new Set(keysB) : null;

  for (const key of keysA) {
    const valA = (a as Record<string, unknown>)[key];
    const valB = (b as Record<string, unknown>)[key];
    const hasKey = keysBSet ? keysBSet.has(key) : keysB.includes(key);
    if (!hasKey || !isEqual(valA, valB)) {
      return false;
    }
  }

  return true;
}

/**
 * Snapshot a value so a captured undo fragment can't be corrupted by later
 * in-place mutation of the live document. Primitives pass through untouched;
 * containers are deep-cloned.
 *
 * The clone is prototype-faithful: each object is recreated with its own
 * prototype, so a null-prototype object snapshots (and therefore restores) as
 * null-prototype and a plain object as plain. `structuredClone` is unsuitable
 * here — it silently normalizes every object to `Object.prototype`, so
 * replaying an undo would corrupt a null-prototype document's flavor. Shared
 * references (and cycles) within one snapshot are preserved via `seen`.
 *
 * The supported domain matches `isEqual`'s: primitives, `Date`s, arrays, and
 * structural objects. Exotic containers with internal slots (`Map`, `Set`) are
 * not valid mill document values and won't survive the clone.
 */
export function cloneValue<V>(value: V, seen = new WeakMap<object, unknown>()): V {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const already = seen.get(value);
  if (already !== undefined) {
    return already as V;
  }
  if (value instanceof Date) {
    const dateCopy = new Date(value);
    seen.set(value, dateCopy);
    return dateCopy as V;
  }
  if (Array.isArray(value)) {
    const copy: Array<unknown> = [];
    seen.set(value, copy);
    for (const item of value) {
      copy.push(cloneValue(item, seen));
    }
    return copy as V;
  }
  const source = value as Record<string, unknown>;
  const copy: Record<string, unknown> = Object.create(Object.getPrototypeOf(source));
  seen.set(value, copy);
  for (const key of Object.keys(source)) {
    copy[key] = cloneValue(source[key], seen);
  }
  return copy as V;
}
