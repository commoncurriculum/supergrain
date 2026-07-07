import { isContiguousAscending, removeIndices, resolveArrayTarget } from "../array-ops";
import { getValueAtPath, hasValueAtPath, setValueAtPath } from "../path";
import { type ArrayFilter, type Query, resolvePaths } from "../query";
import { capturePathUndo, type MutableUndo, undoPushSpec, undoSet } from "../undo";
import { cloneValue, describeValue, isEqual } from "../util";

// Shared execution context + helpers used by every operator. Each operator
// receives the unwrapped document, the undo accumulator, and the query +
// arrayFilters needed to resolve positional paths.

export interface OperatorContext {
  raw: object;
  undo: MutableUndo;
  query: Query;
  arrayFilters: ReadonlyArray<ArrayFilter>;
  // When set, `null` intermediates/targets are treated as absent — created for
  // writing operators ($set/$push/$addToSet/…), no-op'd for removals. Off by
  // default so mill stays faithful to MongoDB.
  allowNullIntermediates: boolean;
}

// The subset of an OperatorContext the path-writing helpers care about.
export function pathWriteOptions(context: OperatorContext): {
  allowNullIntermediates: boolean;
} {
  return { allowNullIntermediates: context.allowNullIntermediates };
}

// Resolve every path in `operations` (expanding positional `$` / `$[]` /
// `$[<id>]`) and hand each concrete path + value to `apply`.
export function eachPath(
  context: OperatorContext,
  operations: Record<string, unknown>,
  apply: (path: string, value: unknown) => void,
): void {
  for (const rawPath of Object.keys(operations)) {
    const value = operations[rawPath];
    for (const path of resolvePaths(context.raw, rawPath, context)) {
      apply(path, value);
    }
  }
}

// ─── numeric writes ($inc / $mul / $min / $max) ─────────────────────────────

function assertNumericTarget(
  operator: string,
  path: string,
  currentValue: unknown,
  allowNull: boolean,
): void {
  // $min/$max compare against an existing null (it sorts below every number);
  // $inc/$mul reject it the way real MongoDB does ("non-numeric type null").
  if (currentValue === null && allowNull) {
    return;
  }
  if (currentValue !== undefined && typeof currentValue !== "number") {
    throw new Error(
      `${operator} path "${path}" must point to a number, received ${describeValue(currentValue)}.`,
    );
  }
}

export interface NumericWrite {
  operator: string;
  // Whether an existing `null` is a valid target ($min/$max) or an error ($inc/$mul).
  allowNull: boolean;
  compute: (previous: number | null | undefined) => number | undefined;
}

export function writeNumeric(context: OperatorContext, path: string, write: NumericWrite): void {
  const previous = getValueAtPath(context.raw, path) as number | null | undefined;
  assertNumericTarget(write.operator, path, previous, write.allowNull);
  const next = write.compute(previous);
  if (next === undefined) {
    return; // no-op
  }
  if (hasValueAtPath(context.raw, path) && isEqual(previous, next)) {
    return; // no-op
  }
  capturePathUndo(context.undo, context.raw, path);
  setValueAtPath(context.raw, path, next, pathWriteOptions(context));
}

// ─── array removal ($pull / $pullAll) ───────────────────────────────────────

// Remove every element matching `op.matches`, recording the fine-grained
// inverse: a contiguous run re-inserts as one `$push` at its original index; a
// scattered removal falls back to `$set`-ing the whole prior array.
export function removeByPredicate(
  context: OperatorContext,
  path: string,
  op: { operator: string; matches: (element: unknown) => boolean },
): void {
  const { arr } = resolveArrayTarget(op.operator, context.raw, path, pathWriteOptions(context));
  if (arr === undefined) {
    return; // absent field — Mongo no-ops $pull / $pullAll
  }

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
    undoPushSpec(context.undo, path, { $each: removedValues, $position: removedIndices[0] });
  } else {
    undoSet(context.undo, path, previousArray);
  }
}
