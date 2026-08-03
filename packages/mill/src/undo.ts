import { getValueAtPath, isArrayIndex, pathCovers, splitPath } from "./path";
import { cloneValue, isContainer } from "./util";

// ─── undo accumulation ──────────────────────────────────────────────────────
//
// The undo document only ever needs four operators to invert anything: `$set`
// and `$unset` for scalar/whole-value restores, and `$push`/`$pop` for the
// fine-grained array inverses. Array edits whose inverse can't be expressed by
// a single granular operator (a scattered `$pull`, a `$sort`, any op on an
// array nested inside another array) fall back to `$set`-ing the whole prior
// array.
//
// The undo document must itself be a legal Mongo update, so no entry's path may
// prefix another's. Recording happens before each op mutates, and two rules
// keep the accumulated entries conflict-free:
//
//   - An entry covered by an existing entry at an ancestor path is skipped —
//     that ancestor already restores the whole region.
//   - A whole-array restore can also arrive *after* entries beneath it (an
//     out-of-bounds index write following an in-bounds one). Its clone of the
//     array is stale — earlier ops already wrote into it — but each such write
//     left an entry holding the original value, so absorbing those entries
//     into the clone reproduces the pristine array (and dropping them removes
//     the conflict).
//
// Absorption only ever meets `$set`/`$unset` entries: a granular `$push`/`$pop`
// inverse whose own path runs through an ancestor array is recorded as that
// array's whole-array restore instead, so no granular entry can sit beneath an
// array for a later restore to collide with.

export interface MutableUndo {
  $set?: Record<string, unknown>;
  $unset?: Record<string, "">;
  $push?: Record<string, unknown>;
  $pop?: Record<string, 1 | -1>;
}

function coveredByExistingEntry(undo: MutableUndo, path: string): boolean {
  for (const existingOps of Object.values(undo)) {
    for (const existingOpPath of Object.keys(existingOps as Record<string, unknown>)) {
      if (pathCovers(existingOpPath, path)) {
        return true;
      }
    }
  }
  return false;
}

export function undoSet(undo: MutableUndo, path: string, value: unknown): void {
  if (coveredByExistingEntry(undo, path)) return;
  (undo.$set ??= {})[path] = value;
}

export function undoUnset(undo: MutableUndo, path: string): void {
  if (coveredByExistingEntry(undo, path)) return;
  (undo.$unset ??= {})[path] = "";
}

/**
 * Record a granular `$push` inverse. Falls back to restoring the outer array
 * when `path` runs through one.
 */
export function undoPushSpec(undo: MutableUndo, raw: object, path: string, spec: unknown): void {
  if (escalateThroughAncestorArray(undo, raw, path)) return;
  (undo.$push ??= {})[path] = spec;
}

/**
 * Record the inverse of replacing the whole array at `path` (edits no granular
 * operator can invert). Falls back to restoring the outer array when `path`
 * runs through one.
 */
export function undoSetArray(
  undo: MutableUndo,
  raw: object,
  path: string,
  previousArray: Array<unknown>,
): void {
  if (escalateThroughAncestorArray(undo, raw, path)) return;
  undoSet(undo, path, previousArray);
}

/**
 * Record the inverse of an append: truncate back to the prior length — `$pop`
 * for one element, `$push` with an empty `$each` and a `$slice` for several.
 * Falls back to restoring the outer array when `path` runs through one.
 */
export function undoTruncate(
  undo: MutableUndo,
  raw: object,
  path: string,
  append: { length: number; count: number },
): void {
  if (escalateThroughAncestorArray(undo, raw, path)) return;
  if (append.count === 1) {
    (undo.$pop ??= {})[path] = 1;
  } else {
    (undo.$push ??= {})[path] = { $each: [], $slice: append.length };
  }
}

// A granular inverse recorded beneath an array would conflict with — and could
// not be absorbed into — a later whole-restore of that array, so record the
// array's restore instead. False when `path` reaches its target through
// objects only. Callers record against a resolved, existing array target, so
// every ancestor is a container.
function escalateThroughAncestorArray(undo: MutableUndo, raw: object, path: string): boolean {
  const parts = splitPath(path);
  let current: unknown = raw;
  for (let i = 1; i < parts.length; i++) {
    current = (current as Record<string, unknown>)[parts[i - 1]!];
    if (Array.isArray(current)) {
      undoArraySnapshot(undo, raw, parts.slice(0, i));
      return true;
    }
  }
  return false;
}

// Whole-array restore at `parts` (the array's own path), absorbing any entries
// already recorded beneath it.
function undoArraySnapshot(undo: MutableUndo, raw: object, parts: Array<string>): void {
  const path = parts.join(".");
  if (coveredByExistingEntry(undo, path)) return;
  const snapshot = cloneValue(getValueAtPath(raw, path)) as object;
  absorbCoveredEntries(undo, path, snapshot);
  (undo.$set ??= {})[path] = snapshot;
}

// Write the original values held by entries under `arrayPath` back into
// `snapshot` (a clone of the array's current state), then drop the entries.
function absorbCoveredEntries(undo: MutableUndo, arrayPath: string, snapshot: object): void {
  for (const operator of ["$set", "$unset"] as const) {
    const entries = undo[operator] ?? {};
    for (const entryPath of Object.keys(entries)) {
      if (pathCovers(arrayPath, entryPath)) {
        const relative = splitPath(entryPath.slice(arrayPath.length + 1));
        let parent: any = snapshot;
        for (let i = 0; i < relative.length - 1; i++) {
          parent = parent[relative[i]!];
        }
        const key = relative[relative.length - 1]!;
        if (operator === "$set") {
          parent[key] = entries[entryPath];
        } else {
          delete parent[key];
        }
        delete entries[entryPath];
      }
    }
    // MongoDB rejects an update with an empty operator object.
    if (Object.keys(entries).length === 0) {
      delete undo[operator];
    }
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
    // Growing a (nested) array through an out-of-bounds *intermediate* index
    // pads it with null; like the leaf case below, the only exact inverse is to
    // restore the whole prior array rather than $unset a single grown index.
    if (
      i > 0 &&
      Array.isArray(current) &&
      isArrayIndex(segment) &&
      Number(segment) >= current.length
    ) {
      undoArraySnapshot(undo, raw, parts.slice(0, i));
      return;
    }
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
    isArrayIndex(leafKey) &&
    Number(leafKey) >= current.length &&
    parts.length > 1
  ) {
    undoArraySnapshot(undo, raw, parts.slice(0, -1));
    return;
  }

  if (isContainer(current) && Object.hasOwn(current, leafKey)) {
    undoSet(undo, path, cloneValue((current as any)[leafKey]));
  } else {
    undoUnset(undo, path);
  }
}
