import { splitPath } from "./path";
import { cloneValue, isContainer } from "./util";

// ─── undo accumulation ──────────────────────────────────────────────────────
//
// The undo document only ever needs four operators to invert anything: `$set`
// and `$unset` for scalar/whole-value restores, and `$push`/`$pop` for the
// fine-grained array inverses. Array edits whose inverse can't be expressed by
// a single granular operator (a scattered `$pull`, a `$sort`) fall back to
// `$set`-ing the whole prior array.

export interface MutableUndo {
  $set?: Record<string, unknown>;
  $unset?: Record<string, "">;
  $push?: Record<string, unknown>;
  $pop?: Record<string, 1 | -1>;
}

export function undoSet(undo: MutableUndo, path: string, value: unknown): void {
  (undo.$set ??= {})[path] = value;
}

export function undoUnset(undo: MutableUndo, path: string): void {
  (undo.$unset ??= {})[path] = "";
}

export function undoPushSpec(undo: MutableUndo, path: string, spec: unknown): void {
  (undo.$push ??= {})[path] = spec;
}

export function undoPop(undo: MutableUndo, path: string, direction: 1 | -1): void {
  (undo.$pop ??= {})[path] = direction;
}

// Undo of an append: truncate the array back to its prior length. A single
// appended element pops cleanly; multiple use `$push` with an empty `$each` and
// a `$slice` truncation — both standard Mongo.
export function undoTruncate(
  undo: MutableUndo,
  path: string,
  append: { length: number; count: number },
): void {
  if (append.count === 1) {
    undoPop(undo, path, 1);
  } else {
    undoPushSpec(undo, path, { $each: [], $slice: append.length });
  }
}

/**
 * Record the inverse needed to restore the value at `path` before a scalar
 * write. Restores previous state *exactly*, including missing-vs-present: if the
 * write creates an absent branch, the undo `$unset`s the shallowest segment that
 * didn't exist; if it overwrites, the undo `$set`s the prior value back. Must be
 * called before the write is applied.
 */
export function capturePathUndo(undo: MutableUndo, raw: object, path: string): void {
  const parts = splitPath(path);
  let current: any = raw;

  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i]!;
    if (
      !isContainer(current) ||
      !Object.hasOwn(current, segment) ||
      !isContainer((current as any)[segment])
    ) {
      const prefix = parts.slice(0, i + 1).join(".");
      if (isContainer(current) && Object.hasOwn(current, segment)) {
        // A non-container value (e.g. a number) is about to be overwritten by a
        // freshly-created branch — snapshot it so undo restores it exactly.
        undoSet(undo, prefix, cloneValue((current as any)[segment]));
      } else {
        undoUnset(undo, prefix);
      }
      return;
    }
    current = (current as any)[segment];
  }

  const leafKey = parts[parts.length - 1]!;

  // Writing past the end of an array grows it (Mongo pads with null). The only
  // exact, replayable inverse is to restore the whole prior array.
  if (
    Array.isArray(current) &&
    /^\d+$/.test(leafKey) &&
    Number(leafKey) >= current.length &&
    parts.length > 1
  ) {
    undoSet(undo, parts.slice(0, -1).join("."), cloneValue(current));
    return;
  }

  if (isContainer(current) && Object.hasOwn(current, leafKey)) {
    undoSet(undo, path, cloneValue((current as any)[leafKey]));
  } else {
    undoUnset(undo, path);
  }
}
