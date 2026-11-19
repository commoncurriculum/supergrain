/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { setActiveSub } from "alien-signals";

import { unwrap } from "../core";
import { readWholeObject } from "../read";
import { defaultCompare } from "./compare";
import { OUTSIDE, type RowResult } from "./row-blocks";

/** A step function, as the chain stores it: the row, and the query's named lookups. */
export type StepFn = (row: unknown, lookups: Readonly<Record<string, unknown>>) => unknown;

export interface Step {
  readonly kind: "filter" | "map";
  readonly fn: StepFn;
}

/**
 * Makes a row's key: from the row, and the key it had (handed back as is
 * when it's the same key, so an unchanged key allocates nothing).
 */
export type RowKey<K> = (row: unknown, previous: K | undefined) => K;

/**
 * The function each row's computed runs: `steps` on the item, then its key.
 * It hands back `previous` (the row's last result) when the value and key
 * are the same, so a rerun that moves nothing allocates nothing and wakes
 * nothing.
 *
 * Without a `map`, a row's value is the item itself, so a rerun that changed
 * nothing is invisible: the row tracks the item as a whole, which costs far
 * less memory than a signal per field (see `readWholeObject`).
 */
export function rowRunner<K>(
  steps: ReadonlyArray<Step>,
  lookups: Readonly<Record<string, unknown>>,
  key: RowKey<K>,
): (item: object, previous: RowResult<unknown, K> | undefined) => RowResult<unknown, K> {
  const mapped = steps.some((step) => step.kind === "map");
  function run(item: object, previous: RowResult<unknown, K> | undefined): RowResult<unknown, K> {
    const row = applySteps(steps, lookups, item);
    if (row === DROPPED) return OUTSIDE;
    const last = previous?.member ? previous : undefined;
    const value = mapped ? sameIfEqual(last?.value, row) : row;
    const k = key(row, last?.key);
    if (last !== undefined && last.value === value && Object.is(last.key, k)) return last;
    return { member: true, value, key: k };
  }
  return mapped ? run : (item, previous) => readWholeObject(unwrap(item), run, item, previous);
}

/** What `applySteps` returns for a row a filter dropped. */
const DROPPED: unique symbol = Symbol("dropped");

/** Run `steps` on `item`: the row they leave, or `DROPPED`. */
function applySteps(
  steps: ReadonlyArray<Step>,
  lookups: Readonly<Record<string, unknown>>,
  item: object,
): unknown {
  let row: unknown = item;
  for (let i = 0; i < steps.length; i++) {
    const { kind, fn } = steps[i]!;
    if (kind === "map") row = fn(row, lookups);
    else if (!fn(row, lookups)) return DROPPED;
  }
  return row;
}

/** A sort key: one part per `orderBy`, compared with {@link defaultCompare}. */
export type SortKey = ReadonlyArray<unknown>;

const NO_KEY: SortKey = [];

/** The key of a list without `orderBy`: always the same empty key. */
export const UNSORTED: RowKey<SortKey> = () => NO_KEY;

/** The key of a sorted list: one part per `orderBy` key function. */
export function sortKey(
  parts: ReadonlyArray<StepFn>,
  lookups: Readonly<Record<string, unknown>>,
): RowKey<SortKey> {
  return (row, previous) => {
    let key: Array<unknown> | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value
    for (let i = 0; i < parts.length; i++) {
      const part = settled(parts[i]!(row, lookups), previous?.[i]);
      if (key !== undefined) key.push(part);
      else if (previous === undefined || !orderedSame(previous[i], part)) {
        key = previous === undefined ? [] : previous.slice(0, i);
        key.push(part);
      }
    }
    return key ?? previous!;
  };
}

/**
 * The key of a `groupBy`. Keys compare like `Map` keys; a rerun compares
 * them with `Object.is`, which tells `0` from `-0` and so at worst refiles
 * a row under the key it already has.
 */
export function groupKey(fn: StepFn, lookups: Readonly<Record<string, unknown>>): RowKey<unknown> {
  return (row) => fn(row, lookups);
}

/**
 * A key part as it is now. An array (say a store array) is copied, reading
 * each item tracked, so the row reruns when an item changes and the sorted
 * rows keep the key they were filed under. `previous` comes back when it
 * holds the same items, so an unchanged key allocates nothing.
 */
function settled(part: unknown, previous: unknown): unknown {
  if (!Array.isArray(part)) return part;
  const before = Array.isArray(previous) ? previous : undefined;
  let same = before?.length === part.length;
  for (let i = 0; same && i < part.length; i++) same = settled(part[i], before![i]) === before![i];
  return same ? before : Array.from(part, (item: unknown, i) => settled(item, before?.[i]));
}

/**
 * Whether two key parts order the same. An object (say a store array) is
 * compared untracked, since comparing reads it and the row must not depend
 * on that; two primitives read nothing.
 */
function orderedSame(a: unknown, b: unknown): boolean {
  if (!isObject(a) && !isObject(b)) return defaultCompare(a, b) === 0;
  const outer = setActiveSub(undefined);
  try {
    return defaultCompare(a, b) === 0;
  } finally {
    setActiveSub(outer);
  }
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * `previous` when `next` is a new plain object with the same fields, so a
 * mapped row keeps its identity when it reruns without changing. Fields are
 * an object literal's: its enumerable string keys (`for…in`), and no symbol
 * keys. A field made with `Object.defineProperty` as non-enumerable isn't
 * compared.
 */
function sameIfEqual(previous: unknown, next: unknown): unknown {
  if (!isPlainObject(previous) || !isPlainObject(next)) return next;
  // Without `Object.keys`, which would make two arrays per rerun. Plain
  // objects inherit no enumerable fields, so `for…in` sees only their own.
  let fields = 0;
  // eslint-disable-next-line guard-for-in -- a plain object's keys are all its own (above)
  for (const key in next) {
    if (!Object.hasOwn(previous, key) || !Object.is(previous[key], next[key])) return next;
    fields++;
  }
  for (const _key in previous) if (--fields < 0) return next;
  // `for…in` skips symbol keys: an object with any can't be compared here.
  if (hasSymbolFields(next) || hasSymbolFields(previous)) return next;
  return previous;
}

/** Whether `value` has an enumerable symbol key (the store's own are hidden). */
function hasSymbolFields(value: object): boolean {
  const symbols = Object.getOwnPropertySymbols(value);
  for (let i = 0; i < symbols.length; i++) {
    if (Object.prototype.propertyIsEnumerable.call(value, symbols[i]!)) return true;
  }
  return false;
}

/** A plain object that isn't a store proxy (reading a proxy's fields here would subscribe the row to them). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || unwrap(value) !== value) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
