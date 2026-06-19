import { deleteValueAtPath, resolveParentPath, setValueAtPath, splitPath } from "../path";
import { resolvePaths } from "../query";
import { capturePathUndo, undoSet } from "../undo";
import { cloneValue, isContainer } from "../util";
import { type OperatorContext } from "./shared";

interface RenameMove {
  from: string;
  to: string;
  value: unknown;
}

// Whether `path` traverses an array on the way to its leaf. MongoDB forbids
// $rename through array elements ("The source field cannot be an array element
// ... has an array field called ...").
function pathRunsThroughArray(raw: object, path: string): boolean {
  const parts = splitPath(path);
  let node: unknown = raw;
  for (let i = 0; i < parts.length - 1; i++) {
    if (Array.isArray(node)) {
      return true;
    }
    if (!isContainer(node)) {
      return false; // a scalar/missing ancestor can't contain an array
    }
    node = (node as Record<string, unknown>)[parts[i]!];
  }
  return Array.isArray(node);
}

// Returns the move to perform, or null when the rename is a no-op (source and
// destination are the same path, or the source doesn't exist). Throws when the
// destination already exists.
function planRename(context: OperatorContext, rawFrom: string, rawTo: string): RenameMove | null {
  const from = resolvePaths(context.raw, rawFrom, context)[0]!;
  const to = resolvePaths(context.raw, rawTo, context)[0]!;
  if (from === to) {
    return null;
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
    // A non-object intermediate blocks traversal — Mongo rejects this ("cannot
    // use the part ... to traverse the element ...") rather than treating it as
    // a no-op. (A *missing leaf* under a real object, below, stays a no-op.)
    throw new TypeError(
      `$rename cannot traverse source path "${from}": a segment runs through a non-object value.`,
    );
  }
  if (!Object.hasOwn(source.parent, source.key)) {
    return null; // missing leaf under a real object — Mongo treats this as a no-op
  }
  const destination = resolveParentPath(context.raw, to);
  if (destination && Object.hasOwn(destination.parent, destination.key)) {
    throw new Error(
      `$rename destination "${to}" already exists. Rename conflicts must be resolved explicitly.`,
    );
  }
  return { from, to, value: source.parent[source.key] };
}

export function $rename(context: OperatorContext, operations: Record<string, string>): void {
  // Resolve all sources before any mutation so a chain of renames reads from the
  // original document, not a partially-renamed one.
  const moves: Array<RenameMove> = [];
  for (const rawFrom of Object.keys(operations)) {
    const move = planRename(context, rawFrom, operations[rawFrom]!);
    if (move) {
      moves.push(move);
    }
  }

  for (const { from, to, value } of moves) {
    // Undo: remove the destination (it didn't exist before) and restore the
    // source. Capture the destination inverse before creating it.
    capturePathUndo(context.undo, context.raw, to);
    undoSet(context.undo, from, cloneValue(value));
    deleteValueAtPath(context.raw, from);
    setValueAtPath(context.raw, to, value);
  }
}
