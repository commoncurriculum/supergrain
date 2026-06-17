// Turns an arbitrary (possibly reactive) value into a plain, render-ready tree
// for the devtools data explorer.
//
// Two jobs at once:
//   1. Subscription. Values pulled out of a silo store are reactive proxies.
//     Walking them by *reading through the proxy* (not unwrapping first) means
//     that, when this runs inside a kernel `effect()` / `tracked()` scope, the
//     explorer subscribes to exactly the fields it displays — so editing a
//     document in place live-updates the open detail view.
//   2. Safety. App data can be deep, cyclic, or huge. Cycles become a
//     `circular` node (deduped by the *raw* target so a proxy and its raw form
//     don't read as distinct), depth and breadth are capped, and exotic values
//     (Date, bigint, Error, Map, Set, function, symbol) get their own node
//     kinds instead of collapsing to `{}` or throwing.

import { unwrap } from "@supergrain/kernel";

/** Default ceilings — generous enough for real documents, bounded enough to stay cheap. */
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_ENTRIES = 100;

export interface SerializeOptions {
  /** Maximum nesting depth before a `max-depth` node is emitted. */
  readonly maxDepth?: number;
  /** Maximum array items / object keys / map entries / set items per node. */
  readonly maxEntries?: number;
}

/**
 * A render-ready, plain (no proxies, no cycles) description of a value. The
 * devtools explorer walks this instead of the live object so rendering can't
 * loop forever or blow the stack.
 */
export type JsonNode =
  | { readonly t: "null" }
  | { readonly t: "undefined" }
  | { readonly t: "boolean"; readonly value: boolean }
  | { readonly t: "number"; readonly value: number; readonly text: string }
  | { readonly t: "string"; readonly value: string }
  | { readonly t: "bigint"; readonly text: string }
  | { readonly t: "date"; readonly text: string }
  | { readonly t: "symbol"; readonly text: string }
  | { readonly t: "function"; readonly name: string }
  | {
      readonly t: "error";
      readonly name: string;
      readonly message: string;
      readonly entries: ReadonlyArray<readonly [string, JsonNode]>;
    }
  | { readonly t: "array"; readonly items: ReadonlyArray<JsonNode>; readonly truncated: number }
  | {
      readonly t: "object";
      readonly entries: ReadonlyArray<readonly [string, JsonNode]>;
      readonly truncated: number;
    }
  | {
      readonly t: "map";
      readonly entries: ReadonlyArray<readonly [string, JsonNode]>;
      readonly size: number;
      readonly truncated: number;
    }
  | {
      readonly t: "set";
      readonly items: ReadonlyArray<JsonNode>;
      readonly size: number;
      readonly truncated: number;
    }
  | { readonly t: "circular" }
  | { readonly t: "max-depth" };

/**
 * Serialize `value` into a {@link JsonNode}. Reads through reactive proxies (so
 * it subscribes when run in a tracked scope) but produces a fully plain result.
 *
 * The walk uses a single closure capturing the caps + the `seen` set, so the
 * recursive helpers stay two-argument and the cycle guard is shared.
 */
export function serialize(value: unknown, options: SerializeOptions = {}): JsonNode {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const seen = new WeakSet<object>();

  function walk(input: unknown, depth: number): JsonNode {
    const leaf = walkLeaf(input);
    if (leaf) return leaf;

    const raw = unwrap(input) as object;
    if (seen.has(raw)) return { t: "circular" };
    if (depth >= maxDepth) return { t: "max-depth" };
    seen.add(raw);
    try {
      return walkComposite(input, depth);
    } finally {
      // Drop after fully walking this node so sibling references to the same
      // object (a DAG, not a cycle) aren't flagged as circular.
      seen.delete(raw);
    }
  }

  function walkLeaf(input: unknown): JsonNode | undefined {
    if (input === null) return { t: "null" };
    if (input === undefined) return { t: "undefined" };
    switch (typeof input) {
      case "boolean": {
        return { t: "boolean", value: input };
      }
      case "number": {
        return { t: "number", value: input, text: numberText(input) };
      }
      case "string": {
        return { t: "string", value: input };
      }
      case "bigint": {
        return { t: "bigint", text: `${input}n` };
      }
      case "symbol": {
        return { t: "symbol", text: input.toString() };
      }
      case "function": {
        return { t: "function", name: (input as { name?: string }).name || "anonymous" };
      }
      default: {
        break;
      }
    }
    // Date is a leaf too, but counts as an object to `typeof`.
    if (input instanceof Date) {
      const valid = !Number.isNaN(input.getTime());
      return { t: "date", text: valid ? input.toISOString() : "Invalid Date" };
    }
    return undefined;
  }

  function walkComposite(input: unknown, depth: number): JsonNode {
    if (input instanceof Error) return serializeError(input, depth);
    if (Array.isArray(input)) {
      const items: Array<JsonNode> = [];
      const { length } = input;
      const limit = Math.min(length, maxEntries);
      for (let i = 0; i < limit; i++) {
        items.push(walk(input[i], depth + 1));
      }
      return { t: "array", items, truncated: Math.max(0, length - limit) };
    }
    if (input instanceof Map) return serializeMap(input, depth);
    if (input instanceof Set) return serializeSet(input, depth);
    return serializeObject(input as Record<string, unknown>, depth);
  }

  function serializeObject(value_: Record<string, unknown>, depth: number): JsonNode {
    const keys = Object.keys(value_);
    const limit = Math.min(keys.length, maxEntries);
    const entries: Array<readonly [string, JsonNode]> = [];
    for (let i = 0; i < limit; i++) {
      const key = keys[i]!;
      entries.push([key, walk(value_[key], depth + 1)]);
    }
    return { t: "object", entries, truncated: Math.max(0, keys.length - limit) };
  }

  function serializeMap(value_: Map<unknown, unknown>, depth: number): JsonNode {
    const entries: Array<readonly [string, JsonNode]> = [];
    let count = 0;
    for (const [k, v] of value_.entries()) {
      if (count >= maxEntries) break;
      entries.push([keyLabel(k), walk(v, depth + 1)]);
      count++;
    }
    return { t: "map", entries, size: value_.size, truncated: Math.max(0, value_.size - count) };
  }

  function serializeSet(value_: Set<unknown>, depth: number): JsonNode {
    const items: Array<JsonNode> = [];
    let count = 0;
    for (const v of value_.values()) {
      if (count >= maxEntries) break;
      items.push(walk(v, depth + 1));
      count++;
    }
    return { t: "set", items, size: value_.size, truncated: Math.max(0, value_.size - count) };
  }

  function serializeError(error: Error, depth: number): JsonNode {
    // Effect's tagged errors (AdapterError / NotFoundError / ProcessorError)
    // carry a `_tag` and extra fields (`type`, `keys`, `cause`, …). Prefer the
    // tag as the display name, and surface own-enumerable props so the cause is
    // visible without expanding a raw object.
    // Reached only from walkComposite, which `walk` guards with the depth/cycle
    // checks — so `depth < maxDepth` already holds here.
    const tagged = error as Error & { _tag?: string };
    const name = tagged._tag ?? error.name;
    const entries: Array<readonly [string, JsonNode]> = [];
    const own = error as unknown as Record<string, unknown>;
    const keys = Object.keys(error).filter((k) => k !== "message");
    // `Error.cause` (and `stack`) are non-enumerable, so Object.keys misses them.
    // Surface `cause` explicitly when present — it usually holds the real
    // failure (e.g. `new Error(msg, { cause })`); Effect's tagged errors already
    // expose it enumerably, so guard against listing it twice.
    if (own["cause"] !== undefined && !keys.includes("cause")) keys.push("cause");
    for (const key of keys.slice(0, maxEntries)) {
      entries.push([key, walk(own[key], depth + 1)]);
    }
    return { t: "error", name, message: error.message, entries };
  }

  return walk(value, 0);
}

function numberText(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  return String(value);
}

function keyLabel(key: unknown): string {
  if (typeof key === "string") return key;
  // Match the bigint leaf's `10n` rendering rather than a bare `10`.
  if (typeof key === "bigint") return `${key}n`;
  try {
    if (typeof key === "object" && key !== null) return JSON.stringify(unwrap(key));
    return String(key);
  } catch {
    // A cyclic key (JSON.stringify throws) or an object with a throwing
    // toString must never crash the inspector — degrade to a placeholder.
    return "[unserializable key]";
  }
}
