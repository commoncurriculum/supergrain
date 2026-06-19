import { eachPath, type OperatorContext, writeNumeric } from "./shared";

export function $min(context: OperatorContext, operations: Record<string, number>): void {
  eachPath(context, operations as Record<string, unknown>, (path, value) => {
    writeNumeric(context, path, {
      operator: "$min",
      allowNull: true,
      compute: (previous) => {
        if (typeof previous === "number") {
          return (value as number) < previous ? (value as number) : undefined;
        }
        // null sorts below every number, so $min keeps it; absent fields are created.
        return previous === undefined ? (value as number) : undefined;
      },
    });
  });
}
