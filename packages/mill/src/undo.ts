import { getValueAtPath, hasValueAtPath, isArrayIndex, pathCovers, splitPath } from "./path";
import { cloneValue, isContainer, isEqual, isObject } from "./util";

// ─── undo via plan, apply, settle ───────────────────────────────────────────
//
// Before anything runs, `planUndo` reads the update document and the pristine
// document to decide, per path, the cheapest saved state that suffices to
// restore it — a *spot*:
//
//   - `value`:  the original value at a path (what a write overwrites)
//   - `absent`: the path didn't exist (a created branch undoes with $unset)
//   - `length`: an array's original length (appends and past-the-end growth
//               undo by truncating — no contents needed, so appending to a
//               huge array plans O(1) work)
//
// After the update applies — the operators contain no undo code — `buildUndo`
// compares each spot against the document and emits the edits that turn it
// back. Every decision is made against the pristine document, so a spot's
// saved state is exact by construction, and `addSpot` keeps spots pairwise
// non-nested (a shallower spot widens to a full `value` and absorbs deeper
// ones), so the emitted paths can never conflict.

type Spot =
  | { kind: "value"; path: string; value: unknown }
  | { kind: "absent"; path: string }
  | { kind: "length"; path: string; length: number };

export type UndoPlan = Map<string, Spot>;

/** Plan what to save. Must run before the update mutates the document. */
export function planUndo(raw: object, operations: Record<string, object>): UndoPlan {
  const plan: UndoPlan = new Map();
  for (const [operator, payload] of Object.entries(operations)) {
    for (const [path, operand] of Object.entries(payload as Record<string, unknown>)) {
      planPath(plan, raw, operator, path, operand);
      if (operator === "$rename") {
        // The destination is written like a $set.
        planPath(plan, raw, "$set", operand as string);
      }
    }
  }
  return plan;
}

// `$` / `$[]` / `$[id]` — which element these resolve to is decided mid-apply,
// so the containing array is saved whole rather than guessed at.
function isPositionalSegment(segment: string): boolean {
  return segment === "$" || segment.startsWith("$[");
}

// A $push whose spec can only append at the tail (no reordering modifiers);
// $addToSet always appends at the tail.
function isTailAppend(operator: string, operand: unknown): boolean {
  if (operator === "$addToSet") {
    return true;
  }
  return (
    operator === "$push" &&
    !(isObject(operand) && ("$position" in operand || "$sort" in operand || "$slice" in operand))
  );
}

function planPath(
  plan: UndoPlan,
  raw: object,
  operator: string,
  path: string,
  operand?: unknown,
): void {
  const parts = splitPath(path);
  let current: any = raw;

  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i]!;
    if (isPositionalSegment(segment)) {
      if (i > 0) {
        addValueSpot(plan, raw, parts.slice(0, i).join("."), current);
      }
      return; // a positional segment at the root is invalid — the op throws
    }
    // Writing through an out-of-bounds index pads the array's tail; its
    // original length is all an undo needs.
    if (Array.isArray(current) && isArrayIndex(segment) && Number(segment) >= current.length) {
      addSpot(plan, raw, {
        kind: "length",
        path: parts.slice(0, i).join("."),
        length: current.length,
      });
      return;
    }
    if (
      !isContainer(current) ||
      !Object.hasOwn(current, segment) ||
      !isContainer((current as any)[segment])
    ) {
      const prefix = parts.slice(0, i + 1).join(".");
      if (isContainer(current) && Object.hasOwn(current, segment)) {
        // A non-container value (e.g. null) about to be overwritten by a
        // created branch — save it so undo restores it exactly.
        addValueSpot(plan, raw, prefix, (current as any)[segment]);
      } else {
        addSpot(plan, raw, { kind: "absent", path: prefix });
      }
      return;
    }
    current = (current as any)[segment];
  }

  const leaf = parts[parts.length - 1]!;
  if (isPositionalSegment(leaf)) {
    if (parts.length > 1) {
      addValueSpot(plan, raw, parts.slice(0, -1).join("."), current);
    }
    return;
  }
  // Same past-the-end rule at the leaf.
  if (
    Array.isArray(current) &&
    isArrayIndex(leaf) &&
    Number(leaf) >= current.length &&
    parts.length > 1
  ) {
    addSpot(plan, raw, {
      kind: "length",
      path: parts.slice(0, -1).join("."),
      length: current.length,
    });
    return;
  }

  const present = Object.hasOwn(current, leaf);
  const leafValue = present ? (current as any)[leaf] : undefined;

  if (Array.isArray(leafValue) && isTailAppend(operator, operand)) {
    addSpot(plan, raw, { kind: "length", path, length: leafValue.length });
    return;
  }
  if (Array.isArray(leafValue) && operator === "$pop" && operand === 1) {
    // Only the popped element is at stake.
    if (leafValue.length > 0) {
      const last = leafValue.length - 1;
      addValueSpot(plan, raw, `${path}.${last}`, leafValue[last]);
    }
    return;
  }

  if (present) {
    addValueSpot(plan, raw, path, leafValue);
  } else {
    addSpot(plan, raw, { kind: "absent", path });
  }
}

function addValueSpot(plan: UndoPlan, raw: object, path: string, value: unknown): void {
  addSpot(plan, raw, { kind: "value", path, value: cloneValue(value) });
}

// Insert a spot, keeping the plan pairwise non-nested: a spot covered by an
// existing one is redundant (both were read from the pristine document), and
// nesting between spots collapses to a full `value` at the shallower path —
// the one case this arises is interior writes plus growth on the same array,
// where the undo inherently needs the whole prior array.
function addSpot(plan: UndoPlan, raw: object, spot: Spot): void {
  if (plan.has(spot.path)) {
    return;
  }
  for (const other of plan.values()) {
    if (pathCovers(other.path, spot.path)) {
      widenToValue(plan, raw, other);
      return;
    }
  }
  let coversExisting = false;
  for (const other of plan.values()) {
    if (pathCovers(spot.path, other.path)) {
      plan.delete(other.path);
      coversExisting = true;
    }
  }
  plan.set(spot.path, spot);
  if (coversExisting) {
    widenToValue(plan, raw, spot);
  }
}

function widenToValue(plan: UndoPlan, raw: object, spot: Spot): void {
  if (spot.kind === "length") {
    plan.set(spot.path, {
      kind: "value",
      path: spot.path,
      value: cloneValue(getValueAtPath(raw, spot.path)),
    });
  }
}

type UndoDocument = Record<string, Record<string, unknown>>;

/** Compare each planned spot against the mutated document and emit the undo. */
export function buildUndo(raw: object, plan: UndoPlan): UndoDocument {
  const undo: UndoDocument = {};
  for (const spot of plan.values()) {
    if (spot.kind === "absent") {
      if (hasValueAtPath(raw, spot.path)) {
        unset(undo, spot.path);
      }
    } else if (spot.kind === "length") {
      const arr = getValueAtPath(raw, spot.path) as Array<unknown>;
      if (arr.length === spot.length + 1) {
        (undo["$pop"] ??= {})[spot.path] = 1;
      } else if (arr.length > spot.length) {
        (undo["$push"] ??= {})[spot.path] = { $each: [], $slice: spot.length };
      }
    } else if (hasValueAtPath(raw, spot.path)) {
      restore(undo, spot.path, spot.value, getValueAtPath(raw, spot.path));
    } else {
      restoreRemoved(undo, raw, spot.path, spot.value);
    }
  }
  return undo;
}

// A saved value whose path no longer exists. A removed tail element (its index
// equals the array's current length) re-appends with $push; everything else is
// $set back.
function restoreRemoved(undo: UndoDocument, raw: object, path: string, value: unknown): void {
  const parts = splitPath(path);
  const leaf = parts[parts.length - 1]!;
  if (isArrayIndex(leaf) && parts.length > 1) {
    const parent = getValueAtPath(raw, parts.slice(0, -1).join("."));
    if (Array.isArray(parent) && parent.length === Number(leaf)) {
      (undo["$push"] ??= {})[path.slice(0, path.length - leaf.length - 1)] = value;
      return;
    }
  }
  set(undo, path, value);
}

function set(undo: UndoDocument, path: string, value: unknown): void {
  (undo["$set"] ??= {})[path] = value;
}

function unset(undo: UndoDocument, path: string): void {
  (undo["$unset"] ??= {})[path] = "";
}

// Emit the edits that turn `after` (live) back into `before` (a pristine
// clone). Descend while both sides stay structural so the restore lands on the
// smallest spots that changed; anything else restores wholesale.
function restore(undo: UndoDocument, path: string, before: unknown, after: unknown): void {
  if (Array.isArray(before) && Array.isArray(after)) {
    restoreArray(undo, path, before, after);
  } else if (
    isPlainObject(before) &&
    isPlainObject(after) &&
    // A prototype-flavor change (null-prototype replaced by plain, or vice
    // versa) can only be restored wholesale — patching inside the replacement
    // would keep its flavor.
    Object.getPrototypeOf(before) === Object.getPrototypeOf(after) &&
    keysAddressable(before) &&
    keysAddressable(after)
  ) {
    restoreObject(undo, path, before, after);
  } else if (!isEqual(before, after)) {
    set(undo, path, before);
  }
}

// Dates, class instances, and null/scalars restore wholesale — only plain
// (or null-prototype) objects are walked into.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// A key that is empty or contains a dot can't be named by a Mongo path, so an
// object holding one restores wholesale.
function keysAddressable(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => /^[^.]+$/u.test(key));
}

function restoreObject(
  undo: UndoDocument,
  path: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const childPath = `${path}.${key}`;
    if (!Object.hasOwn(before, key)) {
      unset(undo, childPath);
    } else if (Object.hasOwn(after, key)) {
      restore(undo, childPath, before[key], after[key]);
    } else {
      set(undo, childPath, before[key]);
    }
  }
}

function restoreArray(
  undo: UndoDocument,
  path: string,
  before: Array<unknown>,
  after: Array<unknown>,
): void {
  if (before.length === after.length) {
    for (let i = 0; i < before.length; i++) {
      restore(undo, `${path}.${i}`, before[i], after[i]);
    }
    return;
  }

  // Elements were appended: truncate back — `$pop` for one, `$slice` for more.
  if (after.length > before.length && prefixEqual(after, before, before.length)) {
    if (after.length - before.length === 1) {
      (undo["$pop"] ??= {})[path] = 1;
    } else {
      (undo["$push"] ??= {})[path] = { $each: [], $slice: before.length };
    }
    return;
  }

  // A contiguous run was removed: push it back where it was. A single element
  // taken from the end re-appends as a plain `$push`.
  if (before.length > after.length) {
    const count = before.length - after.length;
    let start = 0;
    while (start < after.length && isEqual(before[start], after[start])) {
      start++;
    }
    if (prefixEqual(after.slice(start), before.slice(start + count), after.length - start)) {
      const run = before.slice(start, start + count);
      if (count === 1 && start === after.length) {
        const [removed] = run;
        (undo["$push"] ??= {})[path] = removed;
      } else {
        (undo["$push"] ??= {})[path] = { $each: run, $position: start };
      }
      return;
    }
  }

  set(undo, path, before);
}

function prefixEqual(a: Array<unknown>, b: Array<unknown>, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (!isEqual(a[i], b[i])) {
      return false;
    }
  }
  return true;
}
