import { removeIndices, resolveArrayTarget } from "../array-ops";
import { getValueAtPath, hasValueAtPath, setValueAtPath } from "../path";
import { type ArrayFilter, type Query, resolvePaths } from "../query";
import { describeValue, isEqual } from "../util";

export interface OperatorContext {
  raw: object;
  query: Query;
  arrayFilters: ReadonlyArray<ArrayFilter>;
  allowNullIntermediates: boolean;
}

export function pathWriteOptions(context: OperatorContext): {
  allowNullIntermediates: boolean;
} {
  return { allowNullIntermediates: context.allowNullIntermediates };
}

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

function assertNumericTarget(
  operator: string,
  path: string,
  currentValue: unknown,
  allowNull: boolean,
): void {
  // Mongo: $min/$max compare against null (it sorts below numbers); $inc/$mul reject it.
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
  allowNull: boolean;
  compute: (previous: number | null | undefined) => number | undefined;
}

export function writeNumeric(context: OperatorContext, path: string, write: NumericWrite): void {
  const stored = getValueAtPath(context.raw, path) as number | null | undefined;
  // Only the arithmetic treats a stored null as absent; undo still restores the null.
  const previous = context.allowNullIntermediates && stored === null ? undefined : stored;
  assertNumericTarget(write.operator, path, previous, write.allowNull);
  const next = write.compute(previous);
  if (next === undefined) {
    return;
  }
  if (hasValueAtPath(context.raw, path) && isEqual(previous, next)) {
    return;
  }
  setValueAtPath(context.raw, path, next, pathWriteOptions(context));
}

export function removeByPredicate(
  context: OperatorContext,
  path: string,
  op: { operator: string; matches: (element: unknown) => boolean },
): void {
  const { arr } = resolveArrayTarget(op.operator, context.raw, path, pathWriteOptions(context));
  if (arr === undefined) {
    return;
  }

  const removedIndices = new Set<number>();
  for (let i = 0; i < arr.length; i++) {
    if (op.matches(arr[i])) {
      removedIndices.add(i);
    }
  }
  if (removedIndices.size === 0) {
    return;
  }
  removeIndices(arr, (index) => removedIndices.has(index));
}
