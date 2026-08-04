import { removeIndices, resolveArrayTarget } from "../array-ops";
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
    const target = direction === -1 ? 0 : arr.length - 1;
    removeIndices(arr, (index) => index === target);
  });
}
