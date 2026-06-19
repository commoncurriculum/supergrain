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

// MongoDB forbids $rename when the source or destination lives inside an array
// element ("The source field cannot be an array element ... has an array field
// called ..."). Reject any path whose traversal passes through an array.
function assertNotArrayElement(raw: object, path: string): void {
  const parts = splitPath(path);
  let current: unknown = raw;
  for (let i = 0; i < parts.length - 1; i++) {
    if (Array.isArray(current)) {
      throw new TypeError(
        `$rename cannot operate on "${path}": MongoDB forbids $rename through array elements.`,
      );
    }
    if (!isContainer(current)) {
      return; // a missing/scalar ancestor is handled by the normal no-op/throw paths
    }
    current = (current as Record<string, unknown>)[parts[i]!];
  }
  if (Array.isArray(current)) {
    throw new TypeError(
      `$rename cannot operate on "${path}": MongoDB forbids $rename through array elements.`,
    );
  }
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
  assertNotArrayElement(context.raw, from);
  assertNotArrayElement(context.raw, to);
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
