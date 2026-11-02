/**
 * A record of how a store array changed, for readers that want the changes
 * rather than the whole array. A query whose source is a store array reads
 * the splices since its last read instead of walking every item.
 *
 * Nothing is recorded for an array until a reader follows it, so arrays no
 * query reads pay nothing. The log keeps only the entries some live reader
 * still needs, and at most `KEEP`. A reader that falls behind it, or meets a
 * change the log can't describe as a splice (a hole, a jump in `length`),
 * walks the array instead. Once every reader is gone (garbage collected),
 * the log is dropped and the array's writes stop paying for it.
 *
 * Entries hold raw values, as the array's target does.
 */

import { unwrap } from "./core";

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
  /** Held weakly: a reader no one holds any more stops keeping the log. */
  readonly readers: Array<WeakRef<LogReader>>;
}

/** A reader's place in an array's log. */
export interface LogReader {
  /** It has seen every change before this position, or -1 if it will walk the array next. */
  position: number;
}

/** Entries kept per array. A reader further behind than this walks the array. */
const KEEP = 256;

const logs = new WeakMap<object, ArrayLog>();

/**
 * Start logging `target` for `reader`, if it wasn't already, and return its
 * log. Call once per reader: the log keeps a weak reference to it.
 */
export function followArray(target: ReadonlyArray<unknown>, reader: LogReader): ArrayLog {
  let log = logs.get(target);
  if (log === undefined) {
    log = { base: 0, entries: [], readers: [] };
    logs.set(target, log);
  }
  log.readers.push(new WeakRef(reader));
  return log;
}

/** Where the log ends: a reader at this position has seen every change. */
export function logEnd(log: ArrayLog): number {
  return log.base + log.entries.length;
}

/**
 * The oldest position a live reader still needs, or `undefined` if none
 * needs any. Forgets readers that are gone, and drops the log with the last.
 */
function oldestNeeded(target: object, log: ArrayLog): number | undefined {
  let oldest = Infinity;
  for (let i = log.readers.length - 1; i >= 0; i--) {
    const reader = log.readers[i]!.deref();
    if (reader === undefined) log.readers.splice(i, 1);
    else if (reader.position >= 0) oldest = Math.min(oldest, reader.position);
  }
  if (log.readers.length === 0) logs.delete(target);
  return oldest === Infinity ? undefined : oldest;
}

/** Add `entry`, first dropping the entries every reader has seen (before `oldest`). */
function record(log: ArrayLog, oldest: number, entry: Splice | null): void {
  const seen = Math.min(oldest, logEnd(log)) - log.base;
  if (seen > 0) {
    log.entries.splice(0, seen);
    log.base += seen;
  }
  log.entries.push(entry);
  if (log.entries.length > KEEP) {
    const drop = log.entries.length - KEEP / 2;
    log.base += drop;
    log.entries.splice(0, drop);
  }
}

/**
 * Record a change to `target`: at `from`, the old items `before` (holes
 * kept) gave way to new ones, and the items after them moved by the change
 * in length. Called by the kernel for every array write;
 * does nothing unless a live reader of `target`'s log needs the entry.
 *
 * Leading and trailing items that are the same before and after are left
 * out, so a `splice` that removes one item records just that item, not the
 * tail behind it. A change that makes or fills a hole is recorded as `null`.
 */
export function logMutation(
  target: ReadonlyArray<unknown>,
  from: number,
  before: ReadonlyArray<unknown>,
  oldLength: number,
): void {
  const log = logs.get(target);
  if (log === undefined) return;
  const oldest = oldestNeeded(target, log);
  if (oldest === undefined) return;
  const same = (a: unknown, b: unknown): boolean => unwrap(a) === unwrap(b);
  // Past `before`, the items didn't change, only moved by the change in length.
  let start = 0;
  let removedEnd = before.length;
  let addedEnd = before.length + target.length - oldLength;
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
  for (let i = start; i < removedEnd; i++) if (!(i in before)) return record(log, oldest, null);
  for (let i = start; i < addedEnd; i++)
    if (!(from + i in target)) return record(log, oldest, null);
  record(log, oldest, {
    index: from + start,
    removed: before.slice(start, removedEnd),
    added: target.slice(from + start, from + addedEnd),
  });
}
