import { isArrayIndex, splitPath } from "./path";
import { cloneValue, isContainer } from "./util";

// ─── undo accumulation ──────────────────────────────────────────────────────
//
// Undo notes are collected in two structures:
//
// `shadow` — a tree mirroring the document that records original state: each
// leaf says "this spot held this value" (emitted as `$set`) or "this spot
// didn't exist" (emitted as `$unset`). Recording walks down the tree, and the
// walk stopping at an existing leaf is what keeps the undo document legal
// (Mongo rejects an update where one path contains another): nothing can be
// recorded inside a region that is already being restored wholesale, because
// there is no place in the tree to put it.
//
// `inverses` — granular array instructions (an append undoes with `$pop`, a
// `$pop` with `$push`, ...) recorded by the operators. They are stored and
// emitted verbatim; only the operator that recorded one knows what it means.
// An instruction whose path passes through an ancestor array is not recorded —
// the outer array is snapshotted into `shadow` instead (restoring it undoes
// the inner edit too). That keeps instructions out of any region a whole-array
// snapshot could cover, so the two structures never overlap; instructions
// never overlap each other because update paths are disjoint (checked before
// anything applies).

type ShadowNode =
  | { kind: "branch"; children: ShadowChildren }
  | { kind: "value"; value: unknown }
  | { kind: "absent" };

type ShadowChildren = Map<string, ShadowNode>;

export interface Undo {
  shadow: ShadowChildren;
  inverses: Array<{ operator: string; path: string; operand: unknown }>;
}

export function createUndo(): Undo {
  return { shadow: new Map(), inverses: [] };
}

// Walk to the map that holds the leaf for `parts`, creating branches along the
// way. Null when the walk runs into an existing leaf: the region is already
// being restored wholesale, so there is nothing further to record.
function childrenFor(shadow: ShadowChildren, parts: ReadonlyArray<string>): ShadowChildren | null {
  let children = shadow;
  for (let i = 0; i < parts.length - 1; i++) {
    const existing = children.get(parts[i]!);
    if (existing === undefined) {
      const branch = { kind: "branch", children: new Map<string, ShadowNode>() } as const;
      children.set(parts[i]!, branch);
      ({ children } = branch);
    } else if (existing.kind === "branch") {
      ({ children } = existing);
    } else {
      return null;
    }
  }
  return children;
}

function recordValue(shadow: ShadowChildren, parts: ReadonlyArray<string>, value: unknown): void {
  const children = childrenFor(shadow, parts);
  if (children === null) {
    return;
  }
  const key = parts[parts.length - 1]!;
  const existing = children.get(key);
  if (existing !== undefined) {
    if (existing.kind !== "branch") {
      return; // this exact spot is already restored — the earlier note wins
    }
    // A whole-array snapshot arriving after notes about spots inside it (an
    // out-of-bounds write following an in-bounds one). The snapshot copied the
    // array *after* those spots were changed, but each note holds the original
    // value, so writing the notes back into the snapshot reproduces the
    // pristine array — and replacing the branch consumes them.
    foldInto(value as object, existing.children);
  }
  children.set(key, { kind: "value", value });
}

function recordAbsent(shadow: ShadowChildren, parts: ReadonlyArray<string>): void {
  const children = childrenFor(shadow, parts);
  if (children !== null) {
    children.set(parts[parts.length - 1]!, { kind: "absent" });
  }
}

function foldInto(snapshot: object, children: ShadowChildren): void {
  for (const [key, node] of children) {
    if (node.kind === "branch") {
      foldInto((snapshot as Record<string, object>)[key]!, node.children);
    } else if (node.kind === "value") {
      (snapshot as Record<string, unknown>)[key] = node.value;
    } else {
      delete (snapshot as Record<string, unknown>)[key];
    }
  }
}

/**
 * Record a granular array instruction — emitted into the undo document as
 * `{ [operator]: { [path]: operand } }`, uninterpreted. Falls back to
 * snapshotting the outer array when `path` passes through one.
 */
export function recordInverse(
  undo: Undo,
  raw: object,
  path: string,
  operator: string,
  operand: unknown,
): void {
  const parts = splitPath(path);
  let current: unknown = raw;
  for (let i = 1; i < parts.length; i++) {
    current = (current as Record<string, unknown>)[parts[i - 1]!];
    if (Array.isArray(current)) {
      recordValue(undo.shadow, parts.slice(0, i), cloneValue(current));
      return;
    }
  }
  undo.inverses.push({ operator, path, operand });
}

/**
 * Record the note needed to restore the value at `path` before a write.
 * Restores previous state *exactly*, including missing-vs-present: if the
 * write creates an absent branch, the undo `$unset`s the shallowest segment
 * that didn't exist; if it overwrites, the undo `$set`s the prior value back.
 * Must be called before the write is applied.
 */
export function capturePathUndo(undo: Undo, raw: object, path: string): void {
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
      recordValue(undo.shadow, parts.slice(0, i), cloneValue(current));
      return;
    }
    if (
      !isContainer(current) ||
      !Object.hasOwn(current, segment) ||
      !isContainer((current as any)[segment])
    ) {
      const prefix = parts.slice(0, i + 1);
      if (isContainer(current) && Object.hasOwn(current, segment)) {
        // A non-container value (e.g. a number) is about to be overwritten by a
        // freshly-created branch — snapshot it so undo restores it exactly.
        recordValue(undo.shadow, prefix, cloneValue((current as any)[segment]));
      } else {
        recordAbsent(undo.shadow, prefix);
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
    recordValue(undo.shadow, parts.slice(0, -1), cloneValue(current));
    return;
  }

  if (isContainer(current) && Object.hasOwn(current, leafKey)) {
    recordValue(undo.shadow, parts, cloneValue((current as any)[leafKey]));
  } else {
    recordAbsent(undo.shadow, parts);
  }
}

/** Emit the collected notes as a flat, conflict-free Mongo update document. */
export function buildUndoDocument(undo: Undo): Record<string, Record<string, unknown>> {
  const doc: Record<string, Record<string, unknown>> = {};
  emit(undo.shadow, "", doc);
  for (const { operator, path, operand } of undo.inverses) {
    (doc[operator] ??= {})[path] = operand;
  }
  return doc;
}

function emit(
  children: ShadowChildren,
  prefix: string,
  doc: Record<string, Record<string, unknown>>,
): void {
  for (const [key, node] of children) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (node.kind === "branch") {
      emit(node.children, path, doc);
    } else if (node.kind === "value") {
      (doc["$set"] ??= {})[path] = node.value;
    } else {
      (doc["$unset"] ??= {})[path] = "";
    }
  }
}
