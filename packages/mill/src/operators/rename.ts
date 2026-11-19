import { deleteValueAtPath, resolveParentPath, setValueAtPath, splitPath } from "../path";
import { resolvePaths } from "../query";
import { isContainer } from "../util";
import { type OperatorContext, pathWriteOptions } from "./shared";

interface RenameMove {
  from: string;
  to: string;
  value: unknown;
}

function pathRunsThroughArray(raw: object, path: string): boolean {
  const parts = splitPath(path);
  let node: unknown = raw;
  for (let i = 0; i < parts.length - 1; i++) {
    if (Array.isArray(node)) {
      return true;
    }
    if (!isContainer(node)) {
      return false;
    }
    node = (node as Record<string, unknown>)[parts[i]!];
  }
  return Array.isArray(node);
}

function planRename(context: OperatorContext, rawFrom: string, rawTo: string): RenameMove | null {
  const from = resolvePaths(context.raw, rawFrom, context)[0]!;
  const to = resolvePaths(context.raw, rawTo, context)[0]!;
  if (from === to) {
    // Mongo rejects, rather than no-ops, a rename to itself.
    throw new Error(`$rename source and destination must differ, but both are "${from}".`);
  }
  for (const path of [from, to]) {
    if (pathRunsThroughArray(context.raw, path)) {
      throw new TypeError(
        `$rename cannot operate on "${path}": MongoDB forbids $rename through array elements.`,
      );
    }
  }
  const source = resolveParentPath(context.raw, from);
  if (!source) {
    // Mongo rejects a non-object intermediate; only a missing leaf is a no-op.
    throw new TypeError(
      `$rename cannot traverse source path "${from}": a segment runs through a non-object value.`,
    );
  }
  if (!Object.hasOwn(source.parent, source.key)) {
    return null;
  }
  // Mongo overwrites an existing destination.
  return { from, to, value: source.parent[source.key] };
}

export function $rename(context: OperatorContext, operations: Record<string, string>): void {
  // Plan every move before mutating so chained renames read the original document.
  const moves: Array<RenameMove> = [];
  for (const rawFrom of Object.keys(operations)) {
    const move = planRename(context, rawFrom, operations[rawFrom]!);
    if (move) {
      moves.push(move);
    }
  }

  for (const { from, to, value } of moves) {
    deleteValueAtPath(context.raw, from);
    setValueAtPath(context.raw, to, value, pathWriteOptions(context));
  }
}
