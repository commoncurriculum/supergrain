import { cloneValue, isEqual } from "./util";

// ─── undo via copy-once, compare-once ───────────────────────────────────────
//
// `update()` copies the top-level fields its paths touch before applying
// anything, then compares the result against the copies and emits the edits
// that turn it back. Because the undo document is derived from two settled
// states in a single walk — which at every spot either descends or emits,
// never both — its paths can never conflict, no matter what the operators did
// in between. The operators contain no undo code at all.

interface OriginalField {
  present: boolean;
  value?: unknown;
}

export type Originals = Map<string, OriginalField>;

/**
 * Clone the original state of every top-level field the update can touch —
 * the first segment of each operator path (and of each `$rename` destination).
 * Must run before the update mutates the document.
 */
export function captureOriginals(raw: object, operations: Record<string, object>): Originals {
  const originals: Originals = new Map();
  for (const [operator, payload] of Object.entries(operations)) {
    for (const [path, target] of Object.entries(payload as Record<string, unknown>)) {
      captureRoot(originals, raw, path);
      if (operator === "$rename") {
        captureRoot(originals, raw, target as string);
      }
    }
  }
  return originals;
}

function captureRoot(originals: Originals, raw: object, path: string): void {
  const root = path.split(".")[0]!;
  if (!originals.has(root)) {
    originals.set(
      root,
      Object.hasOwn(raw, root)
        ? { present: true, value: cloneValue((raw as Record<string, unknown>)[root]) }
        : { present: false },
    );
  }
}

type UndoDocument = Record<string, Record<string, unknown>>;

/** Compare the mutated document against the originals and emit the undo. */
export function buildUndo(raw: object, originals: Originals): UndoDocument {
  const undo: UndoDocument = {};
  for (const [root, original] of originals) {
    const present = Object.hasOwn(raw, root);
    if (!original.present) {
      if (present) {
        unset(undo, root);
      }
    } else if (present) {
      restore(undo, root, original.value, (raw as Record<string, unknown>)[root]);
    } else {
      set(undo, root, original.value);
    }
  }
  return undo;
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
