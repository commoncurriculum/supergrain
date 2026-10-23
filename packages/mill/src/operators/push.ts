import { setProperty } from "@supergrain/kernel/internal";

import { applyPushModifiers, parsePushSpec, pushToArray, resolveArrayTarget } from "../array-ops";
import { setValueAtPath } from "../path";
import { isEqual } from "../util";
import { eachPath, type OperatorContext, pathWriteOptions } from "./shared";

export function $push(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, spec) => {
    const target = resolveArrayTarget("$push", context.raw, path, pathWriteOptions(context));
    const { items, position, slice, sort } = parsePushSpec(spec);

    if (target.arr === undefined) {
      // Absent field — Mongo creates the array (applying any modifiers).
      const created = applyPushModifiers([], items, { position, slice, sort });
      setValueAtPath(context.raw, path, created, pathWriteOptions(context));
      return;
    }
    const { arr } = target;

    const pureAppend =
      sort === undefined &&
      slice === undefined &&
      (position === undefined || position >= arr.length);

    if (pureAppend) {
      if (items.length === 0) {
        return; // no-op
      }
      pushToArray(arr, items);
      return;
    }

    // Hard case ($position into the middle, $sort, $slice): compute the result
    // per Mongo semantics and replace the array wholesale.
    const next = applyPushModifiers(arr, items, { position, slice, sort });
    if (isEqual(next, arr)) {
      return; // no-op
    }
    setProperty(target.parent, target.key, next);
  });
}
