/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { setActiveSub } from "alien-signals";

import { unwrap } from "../core";
import { readWholeObject } from "../read";
import { defaultCompare } from "./compare";
import { OUTSIDE, type RowResult } from "./row-blocks";

export type StepFn = (row: unknown, lookups: Readonly<Record<string, unknown>>) => unknown;

export interface Step {
  readonly kind: "filter" | "map";
  readonly fn: StepFn;
}

// Must return `previous` itself when the key is unchanged.
export type RowKey<K> = (row: unknown, previous: K | undefined) => K;

// Without a `map`, extra reruns can't change the result, which is what makes
// tracking the item as a whole (readWholeObject) safe.
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

const DROPPED: unique symbol = Symbol("dropped");

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

export type SortKey = ReadonlyArray<unknown>;

const NO_KEY: SortKey = [];

export const UNSORTED: RowKey<SortKey> = () => NO_KEY;

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

// Reruns compare with Object.is (0 !== -0): at worst a harmless refile.
export function groupKey(fn: StepFn, lookups: Readonly<Record<string, unknown>>): RowKey<unknown> {
  return (row) => fn(row, lookups);
}

// Arrays are copied so the sorted rows keep the key they were filed under,
// even if a store array key mutates later.
function settled(part: unknown, previous: unknown): unknown {
  if (!Array.isArray(part)) return part;
  const before = Array.isArray(previous) ? previous : undefined;
  let same = before?.length === part.length;
  for (let i = 0; same && i < part.length; i++) same = settled(part[i], before![i]) === before![i];
  return same ? before : Array.from(part, (item: unknown, i) => settled(item, before?.[i]));
}

// Objects compared untracked: the row must not subscribe to what comparing reads.
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

// Non-enumerable fields are not compared.
function sameIfEqual(previous: unknown, next: unknown): unknown {
  if (!isPlainObject(previous) || !isPlainObject(next)) return next;
  // for...in, not Object.keys, to avoid allocating arrays per rerun.
  let fields = 0;
  // eslint-disable-next-line guard-for-in -- a plain object's keys are all its own (above)
  for (const key in next) {
    if (!Object.hasOwn(previous, key) || !Object.is(previous[key], next[key])) return next;
    fields++;
  }
  for (const _key in previous) if (--fields < 0) return next;
  // for...in skips symbol keys.
  if (hasSymbolFields(next) || hasSymbolFields(previous)) return next;
  return previous;
}

function hasSymbolFields(value: object): boolean {
  const symbols = Object.getOwnPropertySymbols(value);
  for (let i = 0; i < symbols.length; i++) {
    if (Object.prototype.propertyIsEnumerable.call(value, symbols[i]!)) return true;
  }
  return false;
}

// Excludes store proxies: reading their fields here would subscribe the row.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || unwrap(value) !== value) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
