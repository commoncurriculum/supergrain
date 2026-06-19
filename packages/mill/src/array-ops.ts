import { deleteProperty, setProperty } from "@supergrain/kernel/internal";

import { getValueAtPath, resolveParentPath } from "./path";
import { describeValue, isObject } from "./util";

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

export function resolveArrayTarget(operator: string, raw: object, path: string): ArrayTarget {
  const result = resolveParentPath(raw, path);
  if (!result) {
    throw new Error(`${operator} path "${path}" must resolve to an existing object or array.`);
  }

  const value = result.parent[result.key];
  if (value !== undefined && !Array.isArray(value)) {
    throw new TypeError(
      `${operator} path "${path}" must point to an array, received ${describeValue(value)}.`,
    );
  }

  return { arr: value as Array<any> | undefined, parent: result.parent, key: result.key };
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

function defaultCompare(a: any, b: any): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortArray(arr: Array<any>, sort: 1 | -1 | Record<string, 1 | -1>): Array<any> {
  if (sort === 1 || sort === -1) {
    return [...arr].sort((a, b) => sort * defaultCompare(a, b));
  }
  const entries = Object.entries(sort);
  return [...arr].sort((a, b) => {
    for (const [key, direction] of entries) {
      const comparison = defaultCompare(getValueAtPath(a, key), getValueAtPath(b, key));
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
