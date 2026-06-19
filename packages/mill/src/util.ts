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
 */
export function cloneValue<V>(value: V): V {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return structuredClone(value);
}
