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

import { $ELEMENTS, $OWN_KEYS, getNode, getNodes } from "./core";

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

/** The log for `target` if someone asked for it. Writers check this before doing any work. */
export function existingLog(target: object): ArrayLog | undefined {
  return logs.get(target);
}

export function record(log: ArrayLog, entry: Splice | null): void {
  log.entries.push(entry);
  if (log.entries.length > KEEP) {
    const drop = log.entries.length - KEEP / 2;
    log.base += drop;
    log.entries.splice(0, drop);
  }
}

/**
 * Record what a mutator did, given the old values from `from` on. Leading and
 * trailing items that are the same before and after are left out, so a
 * `splice` that removes one item records just that item, not the tail behind it.
 */
export function recordMutation(
  log: ArrayLog,
  target: ReadonlyArray<unknown>,
  from: number,
  before: ReadonlyArray<unknown>,
  same: (a: unknown, b: unknown) => boolean,
): void {
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
