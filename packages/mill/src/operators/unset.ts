import { hasValueAtPath, unsetValueAtPath } from "../path";
import { eachPath, type OperatorContext } from "./shared";

export function $unset(context: OperatorContext, operations: Record<string, unknown>): void {
  eachPath(context, operations, (path) => {
    if (!hasValueAtPath(context.raw, path)) {
      return; // no-op
    }
    unsetValueAtPath(context.raw, path);
  });
}
