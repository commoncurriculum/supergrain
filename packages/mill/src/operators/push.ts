import { setProperty } from "@supergrain/kernel/internal";

import { applyPushModifiers, parsePushSpec, pushToArray, resolveArrayTarget } from "../array-ops";
import { setValueAtPath } from "../path";
import { capturePathUndo, undoSet, undoTruncate } from "../undo";
import { cloneValue, isEqual } from "../util";
import { eachPath, type OperatorContext } from "./shared";

export function $push(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, spec) => {
    const target = resolveArrayTarget("$push", context.raw, path);
    const { items, position, slice, sort } = parsePushSpec(spec);

    if (target.arr === undefined) {
      // Absent field — Mongo creates the array (applying any modifiers). The
      // inverse is to remove the field it created.
      const created = applyPushModifiers([], items, { position, slice, sort });
      capturePathUndo(context.undo, context.raw, path);
      setValueAtPath(context.raw, path, created);
      return;
    }
    const arr = target.arr;

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
    setProperty(target.parent, target.key, next);
    undoSet(context.undo, path, previousArray);
  });
}
