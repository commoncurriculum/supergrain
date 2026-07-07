import { setProperty, deleteProperty } from "@supergrain/kernel/internal";
import { match } from "ts-pattern";

import { getValueAtPath, type PathWriteOptions, resolveParentPath, splitPath } from "./path";
import { describeValue, isContainer, isObject } from "./util";

// ─── array primitives (fine-grained, in place) ──────────────────────────────
//
// Pure array helpers shared by the array operators. They drive the kernel's
// write primitives directly so a reactive document wakes only the indices that
// actually change.

/**
 * Resolve the array a `$push`/`$pull`/… targets, distinguishing the three cases
 * MongoDB treats differently:
 *   - `arr` is the array          → operate on it.
 *   - `arr` is `undefined`        → the field is absent. Mongo creates it for
 *                                   `$push`/`$addToSet` and no-ops for
 *                                   `$pull`/`$pullAll`/`$pop`; the caller decides.
 *   - throws                      → the path can't resolve (a scalar sits in the
 *                                   way) or the field exists but isn't an array.
 */
export interface ArrayTarget {
  arr: Array<any> | undefined;
  parent: any;
  key: string;
}

// Whether some ancestor on `path` is a present non-container (a scalar blocking
// traversal), as opposed to merely absent. A scalar in the way is an error for
// every array operator; a merely-absent ancestor means the field doesn't exist
// yet (Mongo creates it for $push/$addToSet, no-ops for $pull/$pullAll/$pop).
// With `allowNullIntermediates`, a `null` ancestor counts as absent (creatable)
// too rather than a blocker.
function pathBlockedByScalar(raw: object, path: string, allowNull: boolean): boolean {
  const parts = splitPath(path);
  let current: unknown = raw;
  const creatable = (value: unknown): boolean =>
    value === undefined || (allowNull && value === null);
  for (let i = 0; i < parts.length - 1; i++) {
    if (creatable(current)) {
      return false; // an absent (or null, when allowed) ancestor — creatable, not blocked
    }
    if (!isContainer(current)) {
      return true; // a scalar ancestor blocks the path
    }
    current = (current as Record<string, unknown>)[parts[i]!];
  }
  return !creatable(current) && !isContainer(current); // a scalar leaf-parent blocks too
}

export function resolveArrayTarget(
  operator: string,
  raw: object,
  path: string,
  options: PathWriteOptions = {},
): ArrayTarget {
  const allowNull = options.allowNullIntermediates ?? false;
  const result = resolveParentPath(raw, path);
  if (!result) {
    // The parent path isn't fully present. A scalar in the way is always an
    // error; a merely-missing intermediate means the field is absent and the
    // caller decides (create vs no-op), exactly like a missing leaf.
    if (pathBlockedByScalar(raw, path, allowNull)) {
      throw new TypeError(
        `${operator} path "${path}" must point to an array — a non-object value blocks the path.`,
      );
    }
    return { arr: undefined, parent: undefined, key: splitPath(path).at(-1)! };
  }

  const value = result.parent[result.key];
  // A `null` target is normally an error; with `allowNullIntermediates` it's
  // treated as absent so $push/$addToSet create the array and $pull/$pullAll/$pop
  // no-op (exactly as they do for a missing field).
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

// Remove the elements at the indices for which `shouldRemove` returns true,
// shifting survivors down with `setProperty` (waking only the indices whose
// value actually changed) and dropping the vacated tail with `deleteProperty` +
// a `length` write.
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

  for (let i = originalLength - 1; i >= writeIndex; i--) {
    deleteProperty(arr, i);
  }
  setProperty(arr, "length", writeIndex);
}

export function isContiguousAscending(indices: Array<number>): boolean {
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1]! + 1) {
      return false;
    }
  }
  return true;
}

function compareScalar(a: any, b: any): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// MongoDB's canonical BSON type ordering (the subset that appears in plain
// update documents): null/missing < numbers < strings < objects < arrays <
// booleans < dates. $sort uses this, not raw JS `<`/`>`, so mixed types and a
// missing sort key order exactly the way Mongo orders them.
function bsonTypeRank(value: unknown): number {
  if (value === null || value === undefined) return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "string") return 3;
  if (value instanceof Date) return 7;
  if (Array.isArray(value)) return 5;
  if (typeof value === "boolean") return 6;
  return 4; // object
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
    .otherwise(() => 0); // null/missing, and objects/arrays (kept stable)
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
