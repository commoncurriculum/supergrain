import { matchesQuery } from "../query";
import { eachPath, type OperatorContext, removeByPredicate } from "./shared";

export function $pull(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, condition) => {
    removeByPredicate(context, path, {
      operator: "$pull",
      matches: (element) => matchesQuery(element, condition),
    });
  });
}
