import { eachPath, type OperatorContext, writeNumeric } from "./shared";

export function $inc(context: OperatorContext, operations: Record<string, number>): void {
  eachPath(context, operations as Record<string, unknown>, (path, value) => {
    writeNumeric(context, path, {
      operator: "$inc",
      allowNull: false,
      compute: (previous) => (typeof previous === "number" ? previous : 0) + (value as number),
    });
  });
}
