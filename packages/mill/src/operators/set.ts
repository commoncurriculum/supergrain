import { getValueAtPath, hasValueAtPath, setValueAtPath } from "../path";
import { capturePathUndo } from "../undo";
import { isEqual } from "../util";
import { eachPath, type OperatorContext, pathWriteOptions } from "./shared";

export function $set(context: OperatorContext, operations: Record<string, unknown>): void {
  eachPath(context, operations, (path, value) => {
    if (hasValueAtPath(context.raw, path) && isEqual(getValueAtPath(context.raw, path), value)) {
      return; // no-op
    }
    capturePathUndo(context.undo, context.raw, path);
    setValueAtPath(context.raw, path, value, pathWriteOptions(context));
  });
}
