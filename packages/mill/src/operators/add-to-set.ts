import { assertArrayTarget, pushToArray } from "../array-ops";
import { resolveParentPath } from "../path";
import { undoTruncate } from "../undo";
import { isEqual, isObject } from "../util";
import { eachPath, type OperatorContext } from "./shared";

export function $addToSet(context: OperatorContext, operations: Record<string, any>): void {
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
