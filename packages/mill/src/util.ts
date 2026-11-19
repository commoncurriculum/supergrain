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

export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }

  // Dates have no enumerable keys; the key check would call all Dates equal.
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

  // Benchmarked: a Set beats `includes` only from about 50 keys.
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

// Not `structuredClone`: it resets every prototype to `Object.prototype`, so
// undo would turn null-prototype objects into plain ones. Map/Set aren't supported.
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
    Object.defineProperty(copy, key, {
      value: cloneValue(source[key], seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy as V;
}
