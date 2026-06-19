import { matchesQuery } from "../query";
import { eachPath, type OperatorContext, removeByPredicate } from "./shared";

export function $pull(context: OperatorContext, operations: Record<string, any>): void {
  eachPath(context, operations, (path, condition) => {
    // Mongo `$pull` removes every element matching the condition as a query:
    // a primitive matches by equality, a document matches field-by-field, and
    // operator expressions (`{ $gt: 5 }`, `{ $in: [...] }`) are honoured.
    removeByPredicate(context, path, {
      operator: "$pull",
      matches: (element) => matchesQuery(element, condition),
    });
  });
}
