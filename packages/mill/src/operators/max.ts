import { eachPath, type OperatorContext, writeNumeric } from "./shared";

export function $max(context: OperatorContext, operations: Record<string, number>): void {
  eachPath(context, operations as Record<string, unknown>, (path, value) => {
    writeNumeric(context, path, {
      operator: "$max",
      allowNull: true,
      compute: (previous) => {
        if (typeof previous === "number") {
          return (value as number) > previous ? (value as number) : undefined;
        }
        // null sorts below every number in Mongo.
        return value as number;
      },
    });
  });
}
