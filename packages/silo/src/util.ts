/**
 * Shallow array equality (by element identity).
 */
export function arrayEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

/**
 * Stable, total string key for a query params object. Object keys are sorted so
 * declaration order doesn't matter. `Date`s are encoded by their timestamp — a
 * bare `Date` has no own-enumerable keys and would otherwise serialize to `{}`,
 * collapsing every date-valued param onto one cache slot. `bigint` is encoded
 * explicitly (it isn't valid JSON and would throw). Non-finite numbers
 * (`NaN` / `±Infinity`) are encoded distinctly — `JSON.stringify` turns them
 * into `null`, which would collide with each other and with a literal `null`.
 * A cyclic params object throws a clear error rather than overflowing the
 * stack. Params are expected to be JSON-ish (primitives, plain objects, arrays,
 * `Date`s); other exotic objects (`Map`/`Set`/class instances) are only
 * distinguished by their own-enumerable keys, so prefer plain params.
 */
export function stableStringify(value: unknown): string {
  return stableStringifyInner(value, new WeakSet<object>());
}

function stableStringifyInner(value: unknown, seen: WeakSet<object>): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Date) return `Date(${value.getTime()})`;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number" && !Number.isFinite(value)) {
    // NaN / Infinity / -Infinity all serialize to "null" via JSON.stringify;
    // encode them distinctly so they don't collapse onto one cache slot.
    if (Number.isNaN(value)) return "NaN";
    return value > 0 ? "Infinity" : "-Infinity";
  }
  if (typeof value !== "object") {
    // string / number / boolean serialize stably; symbol / function are not
    // valid JSON (JSON.stringify → undefined), so fall back to String() to
    // keep this function total rather than returning a non-string.
    return JSON.stringify(value) ?? String(value);
  }
  if (seen.has(value)) {
    throw new Error(
      "@supergrain/silo: query params must be acyclic — a cycle was found while building the cache key",
    );
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((v) => stableStringifyInner(v, seen)).join(",")}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringifyInner(obj[k], seen)}`)
      .join(",")}}`;
  } finally {
    // Drop after fully serializing this node so sibling references to the same
    // object (a DAG, not a cycle) aren't falsely flagged.
    seen.delete(value);
  }
}
