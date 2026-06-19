import { removeIndices, resolveArrayTarget } from "../array-ops";
import { undoPushSpec } from "../undo";
import { cloneValue } from "../util";
import { eachPath, type OperatorContext } from "./shared";

export function $pop(context: OperatorContext, operations: Record<string, 1 | -1>): void {
  eachPath(context, operations as Record<string, unknown>, (path, direction) => {
    const { arr } = resolveArrayTarget("$pop", context.raw, path);
    if (arr === undefined || arr.length === 0) {
      return; // absent or empty — no-op
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
