// Entries hold raw values, not proxies.

import { unwrap } from "./core";

export interface Splice {
  readonly index: number;
  readonly removed: ReadonlyArray<unknown>;
  readonly added: ReadonlyArray<unknown>;
}

export interface ArrayLog {
  base: number;
  /** `null` marks a change that wasn't a splice (a hole, a length jump). */
  readonly entries: Array<Splice | null>;
  readonly readers: Array<WeakRef<LogReader>>;
}

export interface LogReader {
  /** -1: it will walk the array next. */
  position: number;
}

const KEEP = 256;

const logs = new WeakMap<object, ArrayLog>();

// Call once per reader. The log holds it weakly: the caller must keep it alive.
export function followArray(target: ReadonlyArray<unknown>, reader: LogReader): ArrayLog {
  let log = logs.get(target);
  if (log === undefined) {
    log = { base: 0, entries: [], readers: [] };
    logs.set(target, log);
  }
  log.readers.push(new WeakRef(reader));
  return log;
}

export function logEnd(log: ArrayLog): number {
  return log.base + log.entries.length;
}

export function catchUp(target: object, log: ArrayLog, reader: LogReader): void {
  const end = logEnd(log);
  reader.position = end;
  if (log.entries.length === 0) return;
  const oldest = oldestNeeded(target, log);
  if (oldest === undefined || oldest >= end) {
    log.entries.length = 0;
    log.base = end;
  }
}

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

function same(a: unknown, b: unknown): boolean {
  return unwrap(a) === unwrap(b);
}

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
