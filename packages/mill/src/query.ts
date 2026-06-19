import { getValueAtPath, splitPath } from "./path";
import { isEqual, isObject } from "./util";

/**
 * A MongoDB query document, used here only to resolve positional update paths
 * (`items.$.name`). It is the standard Mongo query grammar — no mill-specific
 * additions — restricted to the subset needed to *select an array element*:
 * field equality, dotted-field equality, the comparison operators, and
 * `$elemMatch`, plus the `$and`/`$or`/`$nor` combinators.
 *
 * It does not need to identify the document itself (the document is already
 * selected); it only has to match enough to pin down which array element the
 * positional `$` refers to. Pass `{}` when an update has no positional paths.
 */
export type Query<T = unknown> = {
  [K in keyof T & string]?: unknown;
} & Record<string, unknown>;

function applyQueryOperator(value: unknown, operator: string, operand: unknown): boolean {
  switch (operator) {
    case "$eq": {
      return isEqual(value, operand);
    }
    case "$ne": {
      return !isEqual(value, operand);
    }
    case "$gt": {
      return (value as any) > (operand as any);
    }
    case "$gte": {
      return (value as any) >= (operand as any);
    }
    case "$lt": {
      return (value as any) < (operand as any);
    }
    case "$lte": {
      return (value as any) <= (operand as any);
    }
    case "$in": {
      return Array.isArray(operand) && operand.some((candidate) => isEqual(value, candidate));
    }
    case "$nin": {
      return Array.isArray(operand) && !operand.some((candidate) => isEqual(value, candidate));
    }
    case "$exists": {
      return (value !== undefined) === Boolean(operand);
    }
    case "$not": {
      return !matchesCondition(value, operand);
    }
    case "$elemMatch": {
      return Array.isArray(value) && value.some((element) => matchesQuery(element, operand));
    }
    default: {
      throw new Error(`Unsupported query operator "${operator}".`);
    }
  }
}

/**
 * Match a single field value against a condition. A condition is either a plain
 * value (equality) or an object of `$`-operators (`{ $gt: 5, $lte: 10 }`).
 */
function matchesCondition(value: unknown, condition: unknown): boolean {
  if (isObject(condition)) {
    const keys = Object.keys(condition);
    if (keys.length > 0 && keys.every((key) => key.startsWith("$"))) {
      return keys.every((operator) => applyQueryOperator(value, operator, condition[operator]));
    }
  }
  return isEqual(value, condition);
}

function fieldValueOf(value: unknown, key: string): unknown {
  if (key.includes(".")) {
    return getValueAtPath(value, key);
  }
  return isObject(value) ? value[key] : undefined;
}

function matchesQueryEntry(value: unknown, key: string, condition: unknown): boolean {
  if (key === "$and") {
    return (condition as Array<unknown>).every((sub) => matchesQuery(value, sub));
  }
  if (key === "$or") {
    return (condition as Array<unknown>).some((sub) => matchesQuery(value, sub));
  }
  if (key === "$nor") {
    return !(condition as Array<unknown>).some((sub) => matchesQuery(value, sub));
  }
  if (key.startsWith("$")) {
    return applyQueryOperator(value, key, condition);
  }
  return matchesCondition(fieldValueOf(value, key), condition);
}

/** Match a document/array-element against a query document. */
export function matchesQuery(value: unknown, query: unknown): boolean {
  if (!isObject(query)) {
    return isEqual(value, query);
  }
  return Object.keys(query).every((key) => matchesQueryEntry(value, key, query[key]));
}

/**
 * Derive, from the query, the condition that an element of the array at
 * `arrayPath` must satisfy for the positional `$` to point at it. Mirrors how
 * Mongo decides which element `$` matches:
 *   - `{ items: { $elemMatch: {...} } }` → the `$elemMatch` sub-query.
 *   - `{ "items.id": 7, "items.done": false }` → an equality sub-query built
 *     from the dotted keys under `items.`.
 *   - `{ items: <value> }` → equality against the whole element.
 */
function conditionForArray(arrayPath: string, query: Query): unknown {
  const direct = query[arrayPath];
  if (isObject(direct) && "$elemMatch" in direct) {
    return direct["$elemMatch"];
  }

  const dotPrefix = `${arrayPath}.`;
  const sub: Record<string, unknown> = {};
  for (const key of Object.keys(query)) {
    if (key.startsWith(dotPrefix)) {
      sub[key.slice(dotPrefix.length)] = query[key];
    }
  }
  if (Object.keys(sub).length > 0) {
    return sub;
  }

  return direct;
}

// The index the positional `$` resolves to: the first element matching the
// query's condition for this array, or — when the query says nothing about the
// array — the first element. Returns -1 when there is no match.
function matchPositionalIndex(array: Array<unknown>, arrayPath: string, query: Query): number {
  const condition = conditionForArray(arrayPath, query);
  if (condition === undefined) {
    return array.length > 0 ? 0 : -1;
  }
  return array.findIndex((element) => matchesQuery(element, condition));
}

function requirePositionalMatch(index: number, arrayPath: string, path: string): number {
  if (index === -1) {
    throw new Error(
      `The positional operator "$" found no element of "${arrayPath}" matching the query for path "${path}".`,
    );
  }
  return index;
}

/**
 * Resolve an update path that may contain positional tokens against the
 * document and query, returning the concrete dotted path(s) it expands to:
 *   - `$`   — the first array element matching the query (one path).
 *   - `$[]` — every array element (zero or more paths).
 * A path with no positional token resolves to itself. Multiple positional
 * tokens are resolved left to right.
 */
export function resolvePaths(doc: unknown, query: Query, path: string): Array<string> {
  const parts = splitPath(path);
  const tokenIndex = parts.findIndex((part) => part === "$" || part === "$[]");
  if (tokenIndex === -1) {
    return [path];
  }

  const prefixParts = parts.slice(0, tokenIndex);
  const suffixParts = parts.slice(tokenIndex + 1);
  const arrayPath = prefixParts.join(".");
  const array = arrayPath === "" ? doc : getValueAtPath(doc, arrayPath);

  if (!Array.isArray(array)) {
    throw new TypeError(
      `Positional path "${path}" requires an array at "${arrayPath}" to resolve "${parts[tokenIndex]}".`,
    );
  }

  const indices =
    parts[tokenIndex] === "$[]"
      ? array.map((_, index) => index)
      : [requirePositionalMatch(matchPositionalIndex(array, arrayPath, query), arrayPath, path)];

  const resolved: Array<string> = [];
  for (const index of indices) {
    const concrete = [...prefixParts, String(index), ...suffixParts].join(".");
    // Recurse to resolve any further positional tokens in the suffix.
    resolved.push(...resolvePaths(doc, query, concrete));
  }
  return resolved;
}
