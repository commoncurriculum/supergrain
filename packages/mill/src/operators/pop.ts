import { removeIndices, resolveArrayTarget } from "../array-ops";
import { recordInverse } from "../undo";
import { cloneValue } from "../util";
import { eachPath, type OperatorContext, pathWriteOptions } from "./shared";

export function $pop(context: OperatorContext, operations: Record<string, 1 | -1>): void {
  eachPath(context, operations as Record<string, unknown>, (path, direction) => {
    if (direction !== 1 && direction !== -1) {
      throw new Error(`$pop expects 1 or -1, found: ${JSON.stringify(direction)}`);
    }
    const { arr } = resolveArrayTarget("$pop", context.raw, path, pathWriteOptions(context));
    if (arr === undefined || arr.length === 0) {
      return; // absent or empty — no-op
    }
    if (direction === -1) {
      const removed = cloneValue(arr[0]);
      recordInverse(context.undo, context.raw, path, "$push", {
        $each: [removed],
        $position: 0,
      });
      removeIndices(arr, (index) => index === 0);
    } else {
      const removed = cloneValue(arr[arr.length - 1]);
      recordInverse(context.undo, context.raw, path, "$push", removed);
      removeIndices(arr, (index) => index === arr.length - 1);
    }
  });
}
