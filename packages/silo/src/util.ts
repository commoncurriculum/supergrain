export function arrayEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

// JSON.stringify would map Date to `{}`, NaN/Infinity to `null`, and throw on
// bigint, so those are encoded explicitly. Map/Set/class instances are keyed
// only by own-enumerable keys.
export function stableStringify(value: unknown): string {
  return stableStringifyInner(value, new WeakSet<object>());
}

function stableStringifyInner(value: unknown, seen: WeakSet<object>): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Date) return `Date(${value.getTime()})`;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (Number.isNaN(value)) return "NaN";
    return value > 0 ? "Infinity" : "-Infinity";
  }
  if (typeof value !== "object") {
    // JSON.stringify returns undefined for symbols and functions.
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
    // Shared references (a DAG, not a cycle) must not be flagged as cycles.
    seen.delete(value);
  }
}
