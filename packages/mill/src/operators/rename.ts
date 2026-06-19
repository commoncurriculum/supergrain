import { deleteValueAtPath, resolveParentPath, setValueAtPath } from "../path";
import { resolvePaths } from "../query";
import { capturePathUndo, undoSet } from "../undo";
import { cloneValue } from "../util";
import { type OperatorContext } from "./shared";

interface RenameMove {
  from: string;
  to: string;
  value: unknown;
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
  const source = resolveParentPath(context.raw, from);
  if (!source || !Object.hasOwn(source.parent, source.key)) {
    return null; // missing source — Mongo treats this as a no-op
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
