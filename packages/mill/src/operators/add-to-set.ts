import { pushToArray, resolveArrayTarget } from "../array-ops";
import { setValueAtPath } from "../path";
import { capturePathUndo, undoTruncate } from "../undo";
import { isEqual, isObject } from "../util";
import { eachPath, type OperatorContext } from "./shared";

function uniqueAdditions(existing: ReadonlyArray<unknown>, candidates: Array<unknown>): Array<any> {
  const additions: Array<any> = [];
  for (const item of candidates) {
    const present =
      existing.some((value) => isEqual(value, item)) ||
      additions.some((value) => isEqual(value, item));
    if (!present) {
      additions.push(item);
    }
  }
  return additions;
}

export function $addToSet(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, spec) => {
    const target = resolveArrayTarget("$addToSet", context.raw, path);
    const candidates =
      isObject(spec) && "$each" in spec && Array.isArray(spec["$each"]) ? spec["$each"] : [spec];

    if (target.arr === undefined) {
      // Absent field — Mongo creates the array with the de-duplicated values.
      capturePathUndo(context.undo, context.raw, path);
      setValueAtPath(context.raw, path, uniqueAdditions([], candidates));
      return;
    }

    const newItems = uniqueAdditions(target.arr, candidates);
    if (newItems.length === 0) {
      return; // no-op
    }

    const previousLength = target.arr.length;
    pushToArray(target.arr, newItems);
    undoTruncate(context.undo, path, { length: previousLength, count: newItems.length });
  });
}
