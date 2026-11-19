import { setProperty } from "@supergrain/kernel/internal";
import { match } from "ts-pattern";

import { getValueAtPath, type PathWriteOptions, resolveParentPath, splitPath } from "./path";
import { describeValue, isContainer, isObject } from "./util";

// `arr` is `undefined` when the field is absent: Mongo creates it for
// `$push`/`$addToSet` and no-ops for `$pull`/`$pullAll`/`$pop`.
export interface ArrayTarget {
  arr: Array<any> | undefined;
  parent: any;
  key: string;
}

function pathBlockedByScalar(raw: object, path: string, allowNull: boolean): boolean {
  const parts = splitPath(path);
  let current: unknown = raw;
  const creatable = (value: unknown): boolean =>
    value === undefined || (allowNull && value === null);
  for (let i = 0; i < parts.length - 1; i++) {
    if (creatable(current)) {
      return false;
    }
    if (!isContainer(current)) {
      return true;
    }
    current = (current as Record<string, unknown>)[parts[i]!];
  }
  return !creatable(current) && !isContainer(current);
}

export function resolveArrayTarget(
  operator: string,
  raw: object,
  path: string,
  options: PathWriteOptions,
): ArrayTarget {
  const allowNull = options.allowNullIntermediates;
  const result = resolveParentPath(raw, path);
  if (!result) {
    if (pathBlockedByScalar(raw, path, allowNull)) {
      throw new TypeError(
        `${operator} path "${path}" must point to an array — a non-object value blocks the path.`,
      );
    }
    return { arr: undefined, parent: undefined, key: splitPath(path).at(-1)! };
  }

  const value = result.parent[result.key];
  const absent = value === undefined || (allowNull && value === null);
  if (!absent && !Array.isArray(value)) {
    throw new TypeError(
      `${operator} path "${path}" must point to an array, received ${describeValue(value)}.`,
    );
  }

  return {
    arr: absent ? undefined : (value as Array<any>),
    parent: result.parent,
    key: result.key,
  };
}

export function pushToArray(arr: Array<any>, itemsToAdd: Array<any>): void {
  const startIndex = arr.length;
  for (let i = 0; i < itemsToAdd.length; i++) {
    setProperty(arr, startIndex + i, itemsToAdd[i]);
  }
}

export function removeIndices(arr: Array<any>, shouldRemove: (index: number) => boolean): void {
  const originalLength = arr.length;
  let writeIndex = 0;

  for (let readIndex = 0; readIndex < originalLength; readIndex++) {
    if (!shouldRemove(readIndex)) {
      if (writeIndex !== readIndex) {
        setProperty(arr, writeIndex, arr[readIndex]);
      }
      writeIndex++;
    }
  }

  setProperty(arr, "length", writeIndex);
}

function compareScalar(a: any, b: any): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// MongoDB's BSON sort order: null/missing < numbers < strings < objects <
// arrays < booleans < dates.
function bsonTypeRank(value: unknown): number {
  if (value === null || value === undefined) return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "string") return 3;
  if (value instanceof Date) return 7;
  if (Array.isArray(value)) return 5;
  if (typeof value === "boolean") return 6;
  return 4;
}

function bsonCompare(a: unknown, b: unknown): number {
  const rankA = bsonTypeRank(a);
  const rankB = bsonTypeRank(b);
  if (rankA !== rankB) {
    return rankA < rankB ? -1 : 1;
  }
  return match(rankA)
    .with(2, 3, () => compareScalar(a, b))
    .with(6, () => compareScalar(a ? 1 : 0, b ? 1 : 0))
    .with(7, () => compareScalar((a as Date).getTime(), (b as Date).getTime()))
    .otherwise(() => 0);
}

function sortArray(arr: Array<any>, sort: 1 | -1 | Record<string, 1 | -1>): Array<any> {
  if (sort === 1 || sort === -1) {
    return [...arr].sort((a, b) => sort * bsonCompare(a, b));
  }
  const entries = Object.entries(sort);
  return [...arr].sort((a, b) => {
    for (const [key, direction] of entries) {
      const comparison = bsonCompare(getValueAtPath(a, key), getValueAtPath(b, key));
      if (comparison !== 0) {
        return direction * comparison;
      }
    }
    return 0;
  });
}

export interface PushModifiers {
  position?: number | undefined;
  slice?: number | undefined;
  sort?: 1 | -1 | Record<string, 1 | -1> | undefined;
}

function resolveInsertIndex(length: number, position: number | undefined): number {
  if (position === undefined) {
    return length;
  }
  if (position < 0) {
    return Math.max(length + position, 0);
  }
  return position;
}

export function applyPushModifiers(
  arr: Array<any>,
  items: Array<any>,
  modifiers: PushModifiers,
): Array<any> {
  let result = [...arr];
  result.splice(resolveInsertIndex(result.length, modifiers.position), 0, ...items);

  if (modifiers.sort !== undefined) {
    result = sortArray(result, modifiers.sort);
  }
  if (modifiers.slice !== undefined) {
    const { slice } = modifiers;
    result = slice >= 0 ? result.slice(0, slice) : result.slice(Math.max(result.length + slice, 0));
  }
  return result;
}

export function parsePushSpec(spec: unknown): {
  items: Array<any>;
  position?: number | undefined;
  slice?: number | undefined;
  sort?: 1 | -1 | Record<string, 1 | -1> | undefined;
} {
  if (isObject(spec) && "$each" in spec && Array.isArray(spec["$each"])) {
    return {
      items: spec["$each"],
      position: spec["$position"] as number | undefined,
      slice: spec["$slice"] as number | undefined,
      sort: spec["$sort"] as 1 | -1 | Record<string, 1 | -1> | undefined,
    };
  }
  return { items: [spec] };
}
