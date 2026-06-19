import { setProperty } from "@supergrain/kernel/internal";

import { applyPushModifiers, assertArrayTarget, parsePushSpec, pushToArray } from "../array-ops";
import { resolveParentPath } from "../path";
import { undoSet, undoTruncate } from "../undo";
import { cloneValue, isEqual } from "../util";
import { eachPath, type OperatorContext } from "./shared";

export function $push(context: OperatorContext, operations: Record<string, any>): void {
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
