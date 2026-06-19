import { describeValue, isEqual } from "../util";
import { eachPath, type OperatorContext, removeByPredicate } from "./shared";

export function $pullAll(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, values) => {
    if (!Array.isArray(values)) {
      throw new TypeError(
        `$pullAll path "${path}" requires an array of values to remove, received ${describeValue(values)}.`,
      );
    }
    removeByPredicate(context, path, {
      operator: "$pullAll",
      matches: (element) => values.some((candidate) => isEqual(element, candidate)),
    });
  });
}
