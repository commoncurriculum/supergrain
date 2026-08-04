import { removeIndices, resolveArrayTarget } from "../array-ops";
import { getValueAtPath, hasValueAtPath, setValueAtPath } from "../path";
import { type ArrayFilter, type Query, resolvePaths } from "../query";
import { describeValue, isEqual } from "../util";

// Shared execution context + helpers used by every operator. Each operator
// receives the unwrapped document and the query + arrayFilters needed to
// resolve positional paths. Undo is derived outside the operators (see
// undo.ts), so they only mutate.

export interface OperatorContext {
  raw: object;
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
  // Only reachable for a stored null — `allowNullIntermediates` normalizes those
  // to `undefined` (absent) before we get here.
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
  const stored = getValueAtPath(context.raw, path) as number | null | undefined;
  // With `allowNullIntermediates`, a `null` *target* counts as absent just like a
  // `null` intermediate does: $inc/$mul start from 0 instead of throwing, and
  // $min/$max take the candidate value rather than keeping the null. Only the
  // arithmetic treats it as absent — the undo plan snapshots the real stored
  // `null` before we run, so a rewind restores it exactly.
  const previous = context.allowNullIntermediates && stored === null ? undefined : stored;
  assertNumericTarget(write.operator, path, previous, write.allowNull);
  const next = write.compute(previous);
  if (next === undefined) {
    return; // no-op
  }
  if (hasValueAtPath(context.raw, path) && isEqual(previous, next)) {
    return; // no-op
  }
  setValueAtPath(context.raw, path, next, pathWriteOptions(context));
}

// ─── array removal ($pull / $pullAll) ───────────────────────────────────────

// Remove every element matching `op.matches`.
export function removeByPredicate(
  context: OperatorContext,
  path: string,
  op: { operator: string; matches: (element: unknown) => boolean },
): void {
  const { arr } = resolveArrayTarget(op.operator, context.raw, path, pathWriteOptions(context));
  if (arr === undefined) {
    return; // absent field — Mongo no-ops $pull / $pullAll
  }

  const removedIndices = new Set<number>();
  for (let i = 0; i < arr.length; i++) {
    if (op.matches(arr[i])) {
      removedIndices.add(i);
    }
  }
  if (removedIndices.size === 0) {
    return; // no-op
  }
  removeIndices(arr, (index) => removedIndices.has(index));
}
