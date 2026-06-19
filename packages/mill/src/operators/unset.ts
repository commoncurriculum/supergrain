import { deleteValueAtPath, hasValueAtPath } from "../path";
import { capturePathUndo } from "../undo";
import { eachPath, type OperatorContext } from "./shared";

export function $unset(context: OperatorContext, operations: Record<string, unknown>): void {
  eachPath(context, operations, (path) => {
    if (!hasValueAtPath(context.raw, path)) {
      return; // no-op
    }
    capturePathUndo(context.undo, context.raw, path);
    deleteValueAtPath(context.raw, path);
  });
}
