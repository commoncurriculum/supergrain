import { eachPath, type OperatorContext, writeNumeric } from "./shared";

export function $mul(context: OperatorContext, operations: Record<string, number>): void {
  eachPath(context, operations as Record<string, unknown>, (path, value) => {
    writeNumeric(context, path, {
      operator: "$mul",
      allowNull: false,
      compute: (previous) => (typeof previous === "number" ? previous : 0) * (value as number),
    });
  });
}
