import { unwrap, getNodesIfExist } from "@supergrain/kernel";
import {
  bumpOwnKeysSignal,
  bumpVersion,
  endBatch,
  profileSignalWrite,
  setProperty,
  startBatch,
} from "@supergrain/kernel/internal";

import {
  type ArrayPullOperations,
  type ArrayWriteOperations,
  deleteValueAtPath,
  type NumericPathOperations,
  resolveParentPath,
  type SetPathOperations,
  setValueAtPath,
  type UnsetPathOperations,
} from "./path";

/**
 * MongoDB-style operators for updating reactive stores.
 *
 * PERFORMANCE NOTE: All operators in this file have been optimized to use
 * setProperty() for ALL mutations, eliminating the need for reconciliation.
 * This ensures that signals are updated immediately during the operation,
 * rather than requiring a separate reconciliation pass.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function assertArrayTarget(
  operator: "$push" | "$pull" | "$addToSet",
  path: string,
  result: { parent: any; key: string } | null,
): Array<any> {
  if (!result) {
    throw new Error(`${operator} path "${path}" must resolve to an existing array.`);
  }

  const value = result.parent[result.key];
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${operator} path "${path}" must point to an array, received ${describeValue(value)}.`,
    );
  }

  return value;
}

function assertNumericTarget(
  operator: "$inc" | "$min" | "$max",
  path: string,
  currentValue: unknown,
): void {
  if (currentValue !== undefined && currentValue !== null && typeof currentValue !== "number") {
    throw new Error(
      `${operator} path "${path}" must point to a number, received ${describeValue(currentValue)}.`,
    );
  }
}

export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);

  if (keysA.length !== keysB.length) {
    return false;
  }

  // Use Set for keysB to avoid quadratic time complexity, but only for large objects
  // Benchmark testing shows Set becomes faster than array.includes() at around 50 keys
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

// Precise function for incrementing numeric values
// OPTIMIZATION: Uses setProperty to ensure signal updates
function incrementValue(parent: any, key: string, increment: number): void {
  const currentValue = parent[key];
  if (typeof currentValue === "number") {
    setProperty(parent, key, currentValue + increment);
  } else if (currentValue === null || currentValue === undefined) {
    setProperty(parent, key, increment);
  }
}

// Precise function for comparing and setting min/max values
// OPTIMIZATION: Uses setProperty to ensure signal updates
interface CompareAndSetOpts {
  parent: any;
  key: string;
  newValue: number;
  isMin: boolean;
}

function compareAndSetValue({ parent, key, newValue, isMin }: CompareAndSetOpts): void {
  const currentValue = parent[key];
  if (typeof currentValue === "number") {
    const shouldUpdate = isMin ? newValue < currentValue : newValue > currentValue;
    if (shouldUpdate) {
      setProperty(parent, key, newValue);
    }
  } else if (currentValue === undefined) {
    setProperty(parent, key, newValue);
  }
}

// Precise function for array push operations
function pushToArray(arr: Array<any>, itemsToAdd: Array<any>): void {
  const startIndex = arr.length;
  for (let i = 0; i < itemsToAdd.length; i++) {
    setProperty(arr, startIndex + i, itemsToAdd[i]);
  }
}

function syncIndexedSignals(nodes: any, arr: Array<any>): void {
  for (const key of Object.keys(nodes)) {
    if (key !== "length" && !isNaN(Number(key))) {
      const sig = nodes[key];
      const newValue = (arr as any)[key];
      if (sig() !== newValue) {
        profileSignalWrite();
        sig(newValue);
      }
    }
  }
}

// Operates on the RAW (unwrapped) array, not through the proxy.
// Must manually manage signals since proxy handlers aren't involved.
function pullFromArray(arr: Array<any>, condition: any): boolean {
  let removed = false;
  const originalLength = arr.length;

  for (let i = arr.length - 1; i >= 0; i--) {
    if (isObjectMatch(arr[i], condition)) {
      arr.splice(i, 1);
      removed = true;
    }
  }

  if (removed && arr.length !== originalLength) {
    bumpVersion(arr);

    const nodes = getNodesIfExist(arr);
    if (nodes) {
      bumpOwnKeysSignal(arr, nodes);

      const lengthSignal = nodes["length"];
      if (lengthSignal && lengthSignal() !== arr.length) {
        profileSignalWrite();
        lengthSignal(arr.length);
      }

      syncIndexedSignals(nodes, arr);
    }
  }

  return removed;
}

// Precise function for addToSet operations
function addUniqueToArray(arr: Array<any>, itemsToAdd: Array<any>): boolean {
  const newItems: Array<any> = [];

  for (const item of itemsToAdd) {
    const existsInArray = arr.some((existing) => isEqual(existing, item));
    const existsInNewItems = newItems.some((existing) => isEqual(existing, item));

    if (!existsInArray && !existsInNewItems) {
      newItems.push(item);
    }
  }

  if (newItems.length > 0) {
    const startIndex = arr.length;
    for (let i = 0; i < newItems.length; i++) {
      setProperty(arr, startIndex + i, newItems[i]);
    }
    return true;
  }
  return false;
}

function $set(target: object, operations: Record<string, unknown>): void {
  for (const path of Object.keys(operations)) {
    setValueAtPath(target, path, operations[path]);
  }
}

function $unset(target: object, operations: Record<string, unknown>): void {
  for (const path of Object.keys(operations)) {
    deleteValueAtPath(target, path);
  }
}

function $inc(target: object, operations: Record<string, number>): void {
  for (const path of Object.keys(operations)) {
    const result = resolveParentPath(target, path);
    if (result) {
      assertNumericTarget("$inc", path, result.parent[result.key]);
      const incValue = operations[path]!;
      incrementValue(result.parent, result.key, incValue);
    } else {
      // Path doesn't exist, create it
      setValueAtPath(target, path, operations[path]!);
    }
  }
}

function $push(target: object, operations: Record<string, any>): void {
  for (const path of Object.keys(operations)) {
    const result = resolveParentPath(target, path);
    const arr = assertArrayTarget("$push", path, result);
    const value = operations[path];
    const itemsToAdd =
      isObject(value) && "$each" in value && Array.isArray(value["$each"])
        ? value["$each"]
        : [value];

    pushToArray(arr, itemsToAdd);
  }
}

function isObjectMatch(obj: any, condition: any): boolean {
  if (!isObject(obj) || !isObject(condition)) {
    return isEqual(obj, condition);
  }

  for (const key of Object.keys(condition)) {
    if (!Object.hasOwn(obj, key) || !isEqual(obj[key], condition[key])) {
      return false;
    }
  }

  return true;
}

function $pull(target: object, operations: Record<string, any>): void {
  for (const path of Object.keys(operations)) {
    const result = resolveParentPath(target, path);
    const arr = assertArrayTarget("$pull", path, result);
    const condition = operations[path];
    pullFromArray(arr, condition);
  }
}

function $addToSet(target: object, operations: Record<string, any>): void {
  for (const path of Object.keys(operations)) {
    const result = resolveParentPath(target, path);
    const arr = assertArrayTarget("$addToSet", path, result);
    const value = operations[path];
    const itemsToAdd =
      isObject(value) && "$each" in value && Array.isArray(value["$each"])
        ? value["$each"]
        : [value];

    addUniqueToArray(arr, itemsToAdd);
  }
}

function $rename(target: object, operations: Record<string, string>): void {
  const renames: Array<{ oldPath: string; newPath: string; value: any }> = [];

  for (const oldPath of Object.keys(operations)) {
    const newPath = operations[oldPath]!;
    const oldResult = resolveParentPath(target, oldPath);
    if (oldResult && Object.hasOwn(oldResult.parent, oldResult.key)) {
      const newResult = resolveParentPath(target, newPath);
      if (oldPath !== newPath && newResult && Object.hasOwn(newResult.parent, newResult.key)) {
        throw new Error(
          `$rename destination "${newPath}" already exists. Rename conflicts must be resolved explicitly.`,
        );
      }
      renames.push({ oldPath, newPath, value: oldResult.parent[oldResult.key] });
    }
  }

  for (const { oldPath, newPath, value } of renames) {
    deleteValueAtPath(target, oldPath);
    setValueAtPath(target, newPath, value);
  }
}

function $min(target: object, operations: Record<string, number>): void {
  for (const path of Object.keys(operations)) {
    const result = resolveParentPath(target, path);
    if (result) {
      assertNumericTarget("$min", path, result.parent[result.key]);
      const newValue = operations[path]!;
      compareAndSetValue({ parent: result.parent, key: result.key, newValue, isMin: true });
    } else {
      // Path doesn't exist, create it
      setValueAtPath(target, path, operations[path]!);
    }
  }
}

function $max(target: object, operations: Record<string, number>): void {
  for (const path of Object.keys(operations)) {
    const result = resolveParentPath(target, path);
    if (result) {
      assertNumericTarget("$max", path, result.parent[result.key]);
      const newValue = operations[path]!;
      compareAndSetValue({ parent: result.parent, key: result.key, newValue, isMin: false });
    } else {
      // Path doesn't exist, create it
      setValueAtPath(target, path, operations[path]!);
    }
  }
}

const operatorList = [
  "$set",
  "$unset",
  "$rename",
  "$inc",
  "$min",
  "$max",
  "$push",
  "$pull",
  "$addToSet",
];

const operators: Record<string, (target: object, operations: any) => void> = {
  $set,
  $unset,
  $inc,
  $push,
  $pull,
  $addToSet,
  $rename,
  $min,
  $max,
};

/**
 * Strict, type-aware update operations for a target shape `T`.
 *
 * Each operator's value type is derived from `T`:
 *   - `$set` / `$unset` accept any path within `T` (see `Path<T>`).
 *   - `$inc` / `$min` / `$max` accept numeric paths only.
 *   - `$push` / `$pull` / `$addToSet` accept array paths only.
 *
 * Per-path value typing is enforced: `$set: { "user.name": 42 }` is rejected
 * when `user.name` is typed as `string`.
 */
export type StrictUpdateOperations<T extends object> = Partial<{
  $set: SetPathOperations<T>;
  $unset: UnsetPathOperations<T>;
  $inc: NumericPathOperations<T>;
  $push: ArrayWriteOperations<T>;
  $pull: ArrayPullOperations<T>;
  $addToSet: ArrayWriteOperations<T>;
  $rename: Record<string, string>;
  $min: NumericPathOperations<T>;
  $max: NumericPathOperations<T>;
}>;

/**
 * Default operations type for `update()`.
 *
 * Strict — callers must supply paths that match `Path<T>` and values that
 * match `PathValue<T, P>` per path.
 */
export type UpdateOperations<T extends object = Record<string, any>> = StrictUpdateOperations<T>;

export function update<T extends object>(target: T, operations: UpdateOperations<T>): void {
  const raw = unwrap(target) as object;
  startBatch();
  try {
    for (const op of operatorList) {
      if (op in operations) {
        const operator = operators[op];
        const opArgs = (operations as any)[op];
        operator?.(raw, opArgs);
      }
    }
  } finally {
    endBatch();
  }
}
