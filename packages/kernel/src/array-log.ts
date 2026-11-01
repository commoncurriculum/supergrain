/**
 * A record of how a store array changed, for readers that want the changes
 * rather than the whole array. A query whose source is a store array reads
 * the splices since its last read instead of walking every item.
 *
 * Nothing is recorded for an array until something asks for its log, so
 * arrays no query reads pay nothing. The log keeps only recent entries. A
 * reader that falls behind it, or meets a change the log can't describe as a
 * splice (a hole, a jump in `length`), walks the array instead.
 *
 * Entries hold raw values, as the array's target does.
 */

import { $ELEMENTS, $OWN_KEYS, getNode, getNodes, unwrap } from "./core";

/** Items removed at `index`, then items added there. */
export interface Splice {
  readonly index: number;
  readonly removed: ReadonlyArray<unknown>;
  readonly added: ReadonlyArray<unknown>;
}

export interface ArrayLog {
  /** The position of `entries[0]`. Positions only grow. */
  base: number;
  /** Recent splices, oldest first. `null` marks a change that wasn't a splice. */
  readonly entries: Array<Splice | null>;
}

/** Entries kept per array. A reader further behind than this walks the array. */
const KEEP = 256;

const logs = new WeakMap<object, ArrayLog>();

/** The log for `target`, started now if it had none. */
export function arrayLog(target: ReadonlyArray<unknown>): ArrayLog {
  let log = logs.get(target);
  if (log === undefined) {
    log = { base: 0, entries: [] };
    logs.set(target, log);
  }
  return log;
}

/** Where the log ends: a reader at this position has seen every change. */
export function logEnd(log: ArrayLog): number {
  return log.base + log.entries.length;
}

function record(log: ArrayLog, entry: Splice | null): void {
  log.entries.push(entry);
  if (log.entries.length > KEEP) {
    const drop = log.entries.length - KEEP / 2;
    log.base += drop;
    log.entries.splice(0, drop);
  }
}

// The writers below are called by the kernel's write path for every array
// write. Each does nothing for an array whose log no one asked for.

/**
 * An index or `length` write to `target`, before it happens, as a splice
 * when it is one. Anything that leaves a hole is recorded as `null`.
 */
export function logWrite(
  target: ReadonlyArray<unknown>,
  key: PropertyKey,
  value: unknown,
  prevLen: number,
): void {
  const log = logs.get(target);
  if (log === undefined) return;
  if (key === "length") {
    if (value === prevLen) return;
    record(
      log,
      (value as number) < prevLen
        ? { index: value as number, removed: target.slice(value as number), added: [] }
        : null,
    );
    return;
  }
  const index = arrayIndex(key);
  if (index === -1) return;
  if (index === prevLen) {
    record(log, { index, removed: [], added: [value] });
  } else if (index > prevLen || !Object.hasOwn(target, index)) {
    record(log, null);
  } else if (unwrap(target[index]) !== unwrap(value)) {
    record(log, { index, removed: [target[index]], added: [value] });
  }
}

/** A deleted index leaves a hole: readers of the log must walk the array. */
export function logDelete(target: object): void {
  const log = logs.get(target);
  if (log !== undefined) record(log, null);
}

/**
 * Record what a mutator did, given the old values from `from` on. Leading and
 * trailing items that are the same before and after are left out, so a
 * `splice` that removes one item records just that item, not the tail behind it.
 */
export function logMutation(
  target: ReadonlyArray<unknown>,
  from: number,
  before: ReadonlyArray<unknown>,
): void {
  const log = logs.get(target);
  if (log === undefined) return;
  const same = (a: unknown, b: unknown): boolean => unwrap(a) === unwrap(b);
  let start = 0;
  let removedEnd = before.length;
  let addedEnd = target.length - from;
  while (start < removedEnd && start < addedEnd && same(before[start], target[from + start])) {
    start++;
  }
  while (
    removedEnd > start &&
    addedEnd > start &&
    same(before[removedEnd - 1], target[from + addedEnd - 1])
  ) {
    removedEnd--;
    addedEnd--;
  }
  if (start === removedEnd && start === addedEnd) return;
  record(log, {
    index: from + start,
    removed: before.slice(start, removedEnd),
    added: target.slice(from + start, from + addedEnd),
  });
}

/**
 * Subscribe the active computed to every change in `target`'s items, without
 * reading them: the same three signals a whole-array `forEach` subscribes to
 * (`length`, `$ELEMENTS` for a replaced item, own keys for a filled hole).
 */
export function trackArrayItems(target: ReadonlyArray<unknown>): void {
  const nodes = getNodes(target);
  getNode(nodes, $OWN_KEYS, 0)();
  getNode(nodes, "length", target.length)();
  getNode(nodes, $ELEMENTS, 0)();
}

/** The array index a property key names, or -1 if it names none. */
function arrayIndex(key: PropertyKey): number {
  if (typeof key === "number") return key;
  if (typeof key !== "string") return -1;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && String(index) === key ? index : -1;
}
