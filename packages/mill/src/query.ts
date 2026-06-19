import { match } from "ts-pattern";

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
  return match(operator)
    .with("$eq", () => isEqual(value, operand))
    .with("$ne", () => !isEqual(value, operand))
    .with("$gt", () => (value as any) > (operand as any))
    .with("$gte", () => (value as any) >= (operand as any))
    .with("$lt", () => (value as any) < (operand as any))
    .with("$lte", () => (value as any) <= (operand as any))
    .with(
      "$in",
      () => Array.isArray(operand) && operand.some((candidate) => isEqual(value, candidate)),
    )
    .with(
      "$nin",
      () => Array.isArray(operand) && !operand.some((candidate) => isEqual(value, candidate)),
    )
    .with("$exists", () => (value !== undefined) === Boolean(operand))
    .with("$not", () => !matchesCondition(value, operand))
    .with(
      "$elemMatch",
      () => Array.isArray(value) && value.some((element) => matchesQuery(element, operand)),
    )
    .otherwise(() => {
      throw new Error(`Unsupported query operator "${operator}".`);
    });
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
// query's condition for this array. Per MongoDB, the array field must appear in
// the query for `$` to resolve — when the query says nothing about the array we
// return -1 so the caller raises the "did not find the match" error. Returns -1
// when there is no match.
function matchPositionalIndex(array: Array<unknown>, arrayPath: string, query: Query): number {
  const condition = conditionForArray(arrayPath, query);
  if (condition === undefined) {
    return -1;
  }
  return array.findIndex((element) => matchesQuery(element, condition));
}

function requirePositionalMatch(index: number, path: string): number {
  if (index === -1) {
    throw new Error(
      `The positional operator did not find the match needed from the query for path "${path}".`,
    );
  }
  return index;
}

/** A single MongoDB arrayFilter document, e.g. `{ "elem.grade": { $gte: 85 } }`. */
export type ArrayFilter = Record<string, unknown>;

/**
 * The identifier an arrayFilter targets — the first segment shared by all of its
 * keys. `{ "elem.grade": ... }` and `{ elem: ... }` both target `elem`.
 */
export function arrayFilterIdentifier(filter: ArrayFilter): string {
  const [firstKey] = Object.keys(filter);
  if (firstKey === undefined) {
    return "";
  }
  const [identifier] = firstKey.split(".");
  return identifier!;
}

function isFilteredToken(part: string): boolean {
  return part.startsWith("$[") && part.endsWith("]") && part.length > 3;
}

function isPositionalToken(part: string): boolean {
  return part === "$" || part === "$[]" || isFilteredToken(part);
}

// Build the per-element predicate for `$[<identifier>]` from the matching
// arrayFilter. Mirrors Mongo: each filter key targets a field of the element
// (`elem.grade` → the element's `grade`; a bare `elem` → the element itself), and
// an element qualifies when every key's condition matches.
function filteredPositionalPredicate(
  identifier: string,
  arrayFilters: ReadonlyArray<ArrayFilter>,
  path: string,
): (element: unknown) => boolean {
  const matching = arrayFilters.filter((filter) => arrayFilterIdentifier(filter) === identifier);
  if (matching.length === 0) {
    throw new Error(`No array filter found for identifier "${identifier}" in path "${path}".`);
  }
  if (matching.length > 1) {
    throw new Error(
      `Found multiple array filters with the same top-level field name "${identifier}".`,
    );
  }

  const filter = matching[0]!;
  const prefix = `${identifier}.`;
  return (element) =>
    Object.keys(filter).every((key) => {
      const fieldValue =
        key === identifier ? element : fieldValueOf(element, key.slice(prefix.length));
      return matchesCondition(fieldValue, filter[key]);
    });
}

/** The query + arrayFilters context positional resolution runs against. */
export interface PathResolution {
  query: Query;
  arrayFilters: ReadonlyArray<ArrayFilter>;
}

/**
 * Resolve an update path that may contain positional tokens against the
 * document and resolution context, returning the concrete dotted path(s) it
 * expands to:
 *   - `$`              — the first array element matching the query (one path).
 *   - `$[]`            — every array element.
 *   - `$[<identifier>]`— every element matching the corresponding arrayFilter.
 * A path with no positional token resolves to itself. Multiple positional
 * tokens are resolved left to right.
 */
export function resolvePaths(
  doc: unknown,
  path: string,
  resolution: PathResolution,
): Array<string> {
  const parts = splitPath(path);
  const tokenIndex = parts.findIndex(isPositionalToken);
  if (tokenIndex === -1) {
    return [path];
  }

  const token = parts[tokenIndex]!;
  const prefixParts = parts.slice(0, tokenIndex);
  const suffixParts = parts.slice(tokenIndex + 1);
  const arrayPath = prefixParts.join(".");
  const array = arrayPath === "" ? doc : getValueAtPath(doc, arrayPath);

  if (!Array.isArray(array)) {
    throw new TypeError(
      `Positional path "${path}" requires an array at "${arrayPath}" to resolve "${token}".`,
    );
  }

  const indices = match(token)
    .with("$[]", () => array.map((_, index) => index))
    .with("$", () => [
      requirePositionalMatch(matchPositionalIndex(array, arrayPath, resolution.query), path),
    ])
    .otherwise((filteredToken) => {
      const predicate = filteredPositionalPredicate(
        filteredToken.slice(2, -1),
        resolution.arrayFilters,
        path,
      );
      return array.map((_, index) => index).filter((index) => predicate(array[index]));
    });

  const resolved: Array<string> = [];
  for (const index of indices) {
    const concrete = [...prefixParts, String(index), ...suffixParts].join(".");
    // Recurse to resolve any further positional tokens in the suffix.
    resolved.push(...resolvePaths(doc, concrete, resolution));
  }
  return resolved;
}
