import { match } from "ts-pattern";

import { getValueAtPath, splitPath } from "./path";
import { isEqual, isObject } from "./util";

/**
 * A MongoDB query document, used only to pick the array element a positional
 * `$` path (`items.$.name`) refers to. Supports field and dotted-field equality,
 * comparison operators, `$elemMatch`, and `$and`/`$or`/`$nor`. Pass `{}` when an
 * update has no positional paths.
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

export function matchesQuery(value: unknown, query: unknown): boolean {
  // A Date has no enumerable keys, so it would read as a match-everything query.
  if (!isObject(query) || query instanceof Date) {
    return isEqual(value, query);
  }
  return Object.keys(query).every((key) => matchesQueryEntry(value, key, query[key]));
}

// Mongo's rule for which element `$` matches: the `$elemMatch` sub-query, else
// the dotted keys under `items.`, else equality against the whole element.
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

// Mongo requires the array field to appear in the query for `$` to resolve.
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

export interface PathResolution {
  query: Query;
  arrayFilters: ReadonlyArray<ArrayFilter>;
}

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
    resolved.push(...resolvePaths(doc, concrete, resolution));
  }
  return resolved;
}
