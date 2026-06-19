import { batch, unwrap } from "@supergrain/kernel";
import { setProperty, deleteProperty } from "@supergrain/kernel/internal";

import {
  type ArrayPopOperations,
  type ArrayPullAllOperations,
  type ArrayPullOperations,
  type ArrayPushOperations,
  type ArrayWriteOperations,
  deleteValueAtPath,
  getValueAtPath,
  hasValueAtPath,
  type NumericPathOperations,
  resolveParentPath,
  type SetPathOperations,
  setValueAtPath,
  splitPath,
  type UnsetPathOperations,
} from "./path";
import { matchesQuery, type Query, resolvePaths } from "./query";
import { cloneValue, describeValue, isContainer, isEqual, isObject } from "./util";

/**
 * MongoDB-style update operators for in-memory documents.
 *
 * `update(doc, query, operations)` applies a standard Mongo update document to
 * `doc`, in place, and returns both the (same) document reference and an `undo`
 * — itself a standard Mongo update document — that reverses the exact changes
 * made. There is no mill-specific syntax: every operator, modifier, query, and
 * undo fragment is plain MongoDB.
 *
 * Mutations are applied to the raw (unwrapped) target with the kernel's own
 * write primitives (`setProperty` / `deleteProperty`) so reactive documents get
 * fine-grained signal updates and the whole call runs in one `batch()`. The
 * same code path mutates a plain object just as happily.
 */

// ─── undo accumulation ──────────────────────────────────────────────────────
//
// The undo document only ever needs four operators to invert anything: `$set`
// and `$unset` for scalar/whole-value restores, and `$push`/`$pop` for the
// fine-grained array inverses. Array edits whose inverse can't be expressed by
// a single granular operator (a scattered `$pull`, a `$sort`) fall back to
// `$set`-ing the whole prior array.

interface MutableUndo {
  $set?: Record<string, unknown>;
  $unset?: Record<string, "">;
  $push?: Record<string, unknown>;
  $pop?: Record<string, 1 | -1>;
}

function undoSet(undo: MutableUndo, path: string, value: unknown): void {
  (undo.$set ??= {})[path] = value;
}

function undoUnset(undo: MutableUndo, path: string): void {
  (undo.$unset ??= {})[path] = "";
}

function undoPushSpec(undo: MutableUndo, path: string, spec: unknown): void {
  (undo.$push ??= {})[path] = spec;
}

function undoPop(undo: MutableUndo, path: string, direction: 1 | -1): void {
  (undo.$pop ??= {})[path] = direction;
}

// Undo of an append: truncate the array back to its prior length. A single
// appended element pops cleanly; multiple use `$push` with an empty `$each` and
// a `$slice` truncation — both standard Mongo.
function undoTruncate(
  undo: MutableUndo,
  path: string,
  append: { length: number; count: number },
): void {
  if (append.count === 1) {
    undoPop(undo, path, 1);
  } else {
    undoPushSpec(undo, path, { $each: [], $slice: append.length });
  }
}

/**
 * Record the inverse needed to restore the value at `path` before a scalar
 * write. Restores previous state *exactly*, including missing-vs-present: if the
 * write creates an absent branch, the undo `$unset`s the shallowest segment that
 * didn't exist; if it overwrites, the undo `$set`s the prior value back. Must be
 * called before the write is applied.
 */
function capturePathUndo(undo: MutableUndo, raw: object, path: string): void {
  const parts = splitPath(path);
  let current: any = raw;

  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i]!;
    if (
      !isContainer(current) ||
      !Object.hasOwn(current, segment) ||
      !isContainer((current as any)[segment])
    ) {
      const prefix = parts.slice(0, i + 1).join(".");
      if (isContainer(current) && Object.hasOwn(current, segment)) {
        // A non-container value (e.g. a number) is about to be overwritten by a
        // freshly-created branch — snapshot it so undo restores it exactly.
        undoSet(undo, prefix, cloneValue((current as any)[segment]));
      } else {
        undoUnset(undo, prefix);
      }
      return;
    }
    current = (current as any)[segment];
  }

  const leafKey = parts[parts.length - 1]!;

  // Writing past the end of an array grows it (Mongo pads with null). The only
  // exact, replayable inverse is to restore the whole prior array.
  if (
    Array.isArray(current) &&
    /^\d+$/.test(leafKey) &&
    Number(leafKey) >= current.length &&
    parts.length > 1
  ) {
    undoSet(undo, parts.slice(0, -1).join("."), cloneValue(current));
    return;
  }

  if (isContainer(current) && Object.hasOwn(current, leafKey)) {
    undoSet(undo, path, cloneValue((current as any)[leafKey]));
  } else {
    undoUnset(undo, path);
  }
}

// ─── validation ─────────────────────────────────────────────────────────────

function assertArrayTarget(
  operator: string,
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

function assertNumericTarget(operator: string, path: string, currentValue: unknown): void {
  if (currentValue !== undefined && currentValue !== null && typeof currentValue !== "number") {
    throw new Error(
      `${operator} path "${path}" must point to a number, received ${describeValue(currentValue)}.`,
    );
  }
}

// ─── array primitives (fine-grained, in place) ──────────────────────────────

function pushToArray(arr: Array<any>, itemsToAdd: Array<any>): void {
  const startIndex = arr.length;
  for (let i = 0; i < itemsToAdd.length; i++) {
    setProperty(arr, startIndex + i, itemsToAdd[i]);
  }
}

// Remove the elements at the indices for which `shouldRemove` returns true,
// shifting survivors down with `setProperty` (waking only the indices whose
// value actually changed) and dropping the vacated tail with `deleteProperty` +
// a `length` write.
function removeIndices(arr: Array<any>, shouldRemove: (index: number) => boolean): void {
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

function isContiguousAscending(indices: Array<number>): boolean {
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

interface PushModifiers {
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

function applyPushModifiers(
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

// ─── operators ──────────────────────────────────────────────────────────────

interface OperatorContext {
  raw: object;
  undo: MutableUndo;
  query: Query;
}

function eachPath(
  context: OperatorContext,
  operations: Record<string, unknown>,
  apply: (path: string, value: unknown) => void,
): void {
  for (const rawPath of Object.keys(operations)) {
    const value = operations[rawPath];
    for (const path of resolvePaths(context.raw, context.query, rawPath)) {
      apply(path, value);
    }
  }
}

function $set(context: OperatorContext, operations: Record<string, unknown>): void {
  eachPath(context, operations, (path, value) => {
    if (hasValueAtPath(context.raw, path) && isEqual(getValueAtPath(context.raw, path), value)) {
      return; // no-op
    }
    capturePathUndo(context.undo, context.raw, path);
    setValueAtPath(context.raw, path, value);
  });
}

function $unset(context: OperatorContext, operations: Record<string, unknown>): void {
  eachPath(context, operations, (path) => {
    if (!hasValueAtPath(context.raw, path)) {
      return; // no-op
    }
    capturePathUndo(context.undo, context.raw, path);
    deleteValueAtPath(context.raw, path);
  });
}

interface NumericWrite {
  operator: string;
  compute: (previous: number | null | undefined) => number | undefined;
}

function writeNumeric(context: OperatorContext, path: string, write: NumericWrite): void {
  const previous = getValueAtPath(context.raw, path) as number | null | undefined;
  assertNumericTarget(write.operator, path, previous);
  const next = write.compute(previous);
  if (next === undefined) {
    return; // no-op
  }
  if (hasValueAtPath(context.raw, path) && isEqual(previous, next)) {
    return; // no-op
  }
  capturePathUndo(context.undo, context.raw, path);
  setValueAtPath(context.raw, path, next);
}

function $inc(context: OperatorContext, operations: Record<string, number>): void {
  eachPath(context, operations as Record<string, unknown>, (path, value) => {
    writeNumeric(context, path, {
      operator: "$inc",
      compute: (previous) => (typeof previous === "number" ? previous : 0) + (value as number),
    });
  });
}

function $mul(context: OperatorContext, operations: Record<string, number>): void {
  eachPath(context, operations as Record<string, unknown>, (path, value) => {
    writeNumeric(context, path, {
      operator: "$mul",
      compute: (previous) => (typeof previous === "number" ? previous : 0) * (value as number),
    });
  });
}

function $min(context: OperatorContext, operations: Record<string, number>): void {
  eachPath(context, operations as Record<string, unknown>, (path, value) => {
    writeNumeric(context, path, {
      operator: "$min",
      compute: (previous) => {
        if (typeof previous === "number") {
          return (value as number) < previous ? (value as number) : undefined;
        }
        return previous === undefined ? (value as number) : undefined;
      },
    });
  });
}

function $max(context: OperatorContext, operations: Record<string, number>): void {
  eachPath(context, operations as Record<string, unknown>, (path, value) => {
    writeNumeric(context, path, {
      operator: "$max",
      compute: (previous) => {
        if (typeof previous === "number") {
          return (value as number) > previous ? (value as number) : undefined;
        }
        return previous === undefined ? (value as number) : undefined;
      },
    });
  });
}

interface RenameMove {
  from: string;
  to: string;
  value: unknown;
}

// Returns the move to perform, or null when the rename is a no-op (source and
// destination are the same path, or the source doesn't exist). Throws when the
// destination already exists.
function planRename(context: OperatorContext, rawFrom: string, rawTo: string): RenameMove | null {
  const from = resolvePaths(context.raw, context.query, rawFrom)[0]!;
  const to = resolvePaths(context.raw, context.query, rawTo)[0]!;
  if (from === to) {
    return null;
  }
  const source = resolveParentPath(context.raw, from);
  if (!source || !Object.hasOwn(source.parent, source.key)) {
    return null; // missing source — Mongo treats this as a no-op
  }
  const destination = resolveParentPath(context.raw, to);
  if (destination && Object.hasOwn(destination.parent, destination.key)) {
    throw new Error(
      `$rename destination "${to}" already exists. Rename conflicts must be resolved explicitly.`,
    );
  }
  return { from, to, value: source.parent[source.key] };
}

function $rename(context: OperatorContext, operations: Record<string, string>): void {
  // Resolve all sources before any mutation so a chain of renames reads from the
  // original document, not a partially-renamed one.
  const moves: Array<RenameMove> = [];
  for (const rawFrom of Object.keys(operations)) {
    const move = planRename(context, rawFrom, operations[rawFrom]!);
    if (move) {
      moves.push(move);
    }
  }

  for (const { from, to, value } of moves) {
    // Undo: remove the destination (it didn't exist before) and restore the
    // source. Capture the destination inverse before creating it.
    capturePathUndo(context.undo, context.raw, to);
    undoSet(context.undo, from, cloneValue(value));
    deleteValueAtPath(context.raw, from);
    setValueAtPath(context.raw, to, value);
  }
}

function parsePushSpec(spec: unknown): {
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

function $push(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, spec) => {
    const arr = assertArrayTarget("$push", path, resolveParentPath(context.raw, path));
    const { items, position, slice, sort } = parsePushSpec(spec);

    const pureAppend =
      sort === undefined &&
      slice === undefined &&
      (position === undefined || position >= arr.length);

    if (pureAppend) {
      if (items.length === 0) {
        return; // no-op
      }
      const previousLength = arr.length;
      pushToArray(arr, items);
      undoTruncate(context.undo, path, { length: previousLength, count: items.length });
      return;
    }

    // Hard case ($position into the middle, $sort, $slice): compute the result
    // per Mongo semantics, replace the array wholesale, and restore the prior
    // array on undo.
    const previousArray = cloneValue(arr) as Array<any>;
    const next = applyPushModifiers(arr, items, { position, slice, sort });
    if (isEqual(next, previousArray)) {
      return; // no-op
    }
    const target = resolveParentPath(context.raw, path)!;
    setProperty(target.parent, target.key, next);
    undoSet(context.undo, path, previousArray);
  });
}

function $pop(context: OperatorContext, operations: Record<string, 1 | -1>): void {
  eachPath(context, operations as Record<string, unknown>, (path, direction) => {
    const arr = assertArrayTarget("$pop", path, resolveParentPath(context.raw, path));
    if (arr.length === 0) {
      return; // no-op
    }
    if (direction === -1) {
      const removed = cloneValue(arr[0]);
      removeIndices(arr, (index) => index === 0);
      undoPushSpec(context.undo, path, { $each: [removed], $position: 0 });
    } else {
      const removed = cloneValue(arr[arr.length - 1]);
      removeIndices(arr, (index) => index === arr.length - 1);
      undoPushSpec(context.undo, path, removed);
    }
  });
}

function removeByPredicate(
  context: OperatorContext,
  path: string,
  op: { operator: string; matches: (element: unknown) => boolean },
): void {
  const arr = assertArrayTarget(op.operator, path, resolveParentPath(context.raw, path));

  const removedIndices: Array<number> = [];
  const removedValues: Array<unknown> = [];
  for (let i = 0; i < arr.length; i++) {
    if (op.matches(arr[i])) {
      removedIndices.push(i);
      removedValues.push(cloneValue(arr[i]));
    }
  }

  if (removedIndices.length === 0) {
    return; // no-op
  }

  const previousArray = cloneValue(arr) as Array<any>;
  const removedSet = new Set(removedIndices);
  removeIndices(arr, (index) => removedSet.has(index));

  if (isContiguousAscending(removedIndices)) {
    // Re-insert the removed run as one block at its original start index.
    undoPushSpec(context.undo, path, { $each: removedValues, $position: removedIndices[0] });
  } else {
    // Scattered removal can't be inverted by a single granular array op.
    undoSet(context.undo, path, previousArray);
  }
}

function $pull(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, condition) => {
    // Mongo `$pull` removes every element matching the condition as a query:
    // a primitive matches by equality, a document matches field-by-field, and
    // operator expressions (`{ $gt: 5 }`, `{ $in: [...] }`) are honoured.
    removeByPredicate(context, path, {
      operator: "$pull",
      matches: (element) => matchesQuery(element, condition),
    });
  });
}

function $pullAll(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, values) => {
    if (!Array.isArray(values)) {
      throw new TypeError(
        `$pullAll path "${path}" requires an array of values to remove, received ${describeValue(values)}.`,
      );
    }
    removeByPredicate(context, path, {
      operator: "$pullAll",
      matches: (element) => values.some((candidate) => isEqual(element, candidate)),
    });
  });
}

function $addToSet(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, spec) => {
    const arr = assertArrayTarget("$addToSet", path, resolveParentPath(context.raw, path));
    const candidates =
      isObject(spec) && "$each" in spec && Array.isArray(spec["$each"]) ? spec["$each"] : [spec];

    const newItems: Array<any> = [];
    for (const item of candidates) {
      const present =
        arr.some((existing) => isEqual(existing, item)) ||
        newItems.some((existing) => isEqual(existing, item));
      if (!present) {
        newItems.push(item);
      }
    }

    if (newItems.length === 0) {
      return; // no-op
    }

    const previousLength = arr.length;
    pushToArray(arr, newItems);
    undoTruncate(context.undo, path, { length: previousLength, count: newItems.length });
  });
}

// Forward-application order. Mongo forbids two operators touching the same path
// in one update, so across operators every path is disjoint and this order only
// has to be internally consistent.
const operatorList = [
  "$set",
  "$unset",
  "$rename",
  "$mul",
  "$inc",
  "$min",
  "$max",
  "$pop",
  "$pull",
  "$pullAll",
  "$push",
  "$addToSet",
] as const;

const operators: Record<string, (context: OperatorContext, operations: any) => void> = {
  $set,
  $unset,
  $rename,
  $mul,
  $inc,
  $min,
  $max,
  $pop,
  $pull,
  $pullAll,
  $push,
  $addToSet,
};

// ─── public types ───────────────────────────────────────────────────────────

/**
 * Strict, type-aware update operations for a target shape `T`.
 *
 * Each operator's value type is derived from `T`:
 *   - `$set` / `$unset` accept any path within `T` (see `Path<T>`), including
 *     positional `cards.$.title` / `cards.$[].title` forms.
 *   - `$inc` / `$mul` / `$min` / `$max` accept numeric paths only.
 *   - `$push` / `$pop` / `$pull` / `$pullAll` / `$addToSet` accept array paths.
 *
 * Per-path value typing is enforced: `$set: { "user.name": 42 }` is rejected
 * when `user.name` is typed as `string`.
 */
export type StrictUpdateOperations<T extends object> = Partial<{
  $set: SetPathOperations<T>;
  $unset: UnsetPathOperations<T>;
  $rename: Record<string, string>;
  $inc: NumericPathOperations<T>;
  $mul: NumericPathOperations<T>;
  $min: NumericPathOperations<T>;
  $max: NumericPathOperations<T>;
  $push: ArrayPushOperations<T>;
  $pop: ArrayPopOperations<T>;
  $pull: ArrayPullOperations<T>;
  $pullAll: ArrayPullAllOperations<T>;
  $addToSet: ArrayWriteOperations<T>;
}>;

/**
 * Default operations type for `update()`.
 *
 * Strict — callers must supply paths that match `Path<T>` and values that
 * match `PathValue<T, P>` per path.
 */
export type UpdateOperations<T extends object = Record<string, any>> = StrictUpdateOperations<T>;

/**
 * The result of an `update()` call: the same `doc` reference back, plus an
 * `undo` — a standard Mongo update document that, applied to the post-update
 * `doc`, reverses the exact changes that were made.
 */
export interface UpdateResult<T extends object> {
  doc: T;
  undo: UpdateOperations<T>;
}

/**
 * Apply a MongoDB update document to `doc` in place.
 *
 * @param doc        The document to mutate (a reactive store or a plain object).
 *                   The same reference is returned in `result.doc`.
 * @param query      A Mongo query used only to resolve positional paths
 *                   (`items.$.name`). Pass `{}` when the update has none.
 * @param operations A standard Mongo update document.
 * @returns          `{ doc, undo }` — `undo` reverses the actual changes made.
 */
export function update<T extends object>(
  doc: T,
  query: Query<T>,
  operations: UpdateOperations<T>,
): UpdateResult<T> {
  const raw = unwrap(doc) as object;
  const undo: MutableUndo = {};
  const context: OperatorContext = { raw, undo, query: query as Query };

  // Coalesce every write in this call into a single notification.
  batch(() => {
    for (const operator of operatorList) {
      if (operator in operations) {
        operators[operator]!(context, (operations as any)[operator]);
      }
    }
  });

  return { doc, undo: undo as UpdateOperations<T> };
}
