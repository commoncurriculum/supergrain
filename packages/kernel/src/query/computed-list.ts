/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { setActiveSub } from "alien-signals";

import { unwrap } from "../core";
import { readWholeObject } from "../read";
import { defaultCompare } from "./compare";
import { createIndex, type Group } from "./index-rows";
import { createList } from "./list";
import { createLookup, type Lookup, type SyncedLookup } from "./lookup";
import { OUTSIDE, type RowResult } from "./row-blocks";

/** Sort direction for {@link Sorted.orderBy}. `null`, `undefined` and `NaN` sort last ascending. */
export type Direction = "asc" | "desc";

type Source<T> = () => Iterable<T>;

/**
 * A list a {@link computedList} can look docs up in: a function that returns
 * its docs (looked up by `id`), or the docs and the key to look them up by.
 * Annotate `key`'s parameter (`key: (user: User) => user.email`): TypeScript
 * can't carry each lookup's doc type from `from` to `key` and also keep each
 * lookup's own key type.
 */
export type LookupSource<T extends object = object> =
  | Source<T>
  | { readonly from: Source<T>; key(doc: T): unknown };

type DocOf<S> = S extends Source<infer T> ? T : S extends { from: Source<infer T> } ? T : never;
type KeyOf<S> = S extends { key(doc: never): infer K }
  ? K
  : DocOf<S> extends { id: infer K }
    ? K
    : never;

/** The named lookup lists, as passed to each step: look docs up with `get(key)` or `getAll(key)`. */
export type Lookups<S> = { readonly [N in keyof S]: Lookup<KeyOf<S[N]>, DocOf<S[N]>> };

/** A query you can still sort and window. Call it to read the result. */
export interface Sorted<Row, L> {
  (): ReadonlyArray<Row>;
  /**
   * Sort by this key. A second `orderBy` breaks ties of the first, and so on.
   * Rows with equal keys keep source order. Keys are numbers, strings,
   * bigints, or arrays of them.
   */
  orderBy(key: (row: Row, lookups: L) => unknown, direction?: Direction): Sorted<Row, L>;
  /** Skip this many rows. A function is read reactively. Read like `Array.prototype.slice` reads it. */
  offset(count: number | (() => number)): Sorted<Row, L>;
  /** Return at most this many rows. A function is read reactively. Read like `Array.prototype.slice` reads it. */
  limit(count: number | (() => number)): Sorted<Row, L>;
}

/**
 * Steps over the rows of one list. Each step gets the row as the steps
 * before it left it, and the query's named lookups. Call the query to read
 * the result.
 */
export interface Query<Row, L> extends Sorted<Row, L> {
  /** Keep the rows for which this returns true. */
  filter<Kept extends Row>(predicate: (row: Row, lookups: L) => row is Kept): Query<Kept, L>;
  filter(predicate: (row: Row, lookups: L) => boolean): Query<Row, L>;
  /** Replace each row with what this returns. Look other docs up here: read the store, or `lookups.name.get(key)`. */
  map<Next>(fn: (row: Row, lookups: L) => Next): Query<Next, L>;
  /**
   * Put the rows that share a key in one group, `{ key, rows }`, with the
   * rows in source order. Groups come in the order of their first row; the
   * steps after this run once per group (count, sum, filter, sort, …). Keys
   * compare like `Map` keys, and `null` and `undefined` are keys too.
   *
   * A group's `rows` is updated in place, so a step that reads it reruns
   * only when that group's rows change.
   */
  groupBy<K>(key: (row: Row, lookups: L) => K): Query<Group<K, Row>, L>;
}

/**
 * A filtered, mapped, sorted, windowed view of a reactive list that updates
 * **one row at a time**:
 *
 * ```ts
 * const openTasks = computedList(() => store.tasks)
 *   .filter((task) => !task.done)
 *   .map((task) => ({ task, owner: store.usersById[task.ownerId] }))
 *   .filter(({ owner }) => owner?.active === true)
 *   .orderBy(({ task }) => task.rank)
 *   .limit(10);
 *
 * openTasks(); // ReadonlyArray<{ task: Task; owner: User | undefined }>
 * ```
 *
 * Each source row runs its steps in its own computed, so a change reruns
 * only the rows that read what changed, and the list then moves only those
 * rows. A step can read anything reactive: reading another doc from the
 * store (a join) is tracked per row like any other field.
 *
 * To look docs up in a list rather than a keyed object, name it in the
 * second argument. Each step then gets it by name, with `get(key)` and `getAll(key)`:
 *
 * ```ts
 * computedList(() => store.tasks, {
 *   users: () => store.users, // looked up by `id`
 *   leads: { from: () => store.users.filter((u) => u.isLead), key: (u: User) => u.email },
 * }).map((task, { users, leads }) => ({ task, owner: users.get(task.ownerId), lead: leads.get(task.leadEmail) }));
 * ```
 *
 * `getAll(key)` gives every doc with that key, in source order (one-to-many:
 * all of a user's tasks). A lookup is built on first use and then updated one
 * doc at a time. Each key read has its own signal or array, written only when
 * that key's docs change, so a change reruns only the rows reading that key.
 *
 * `groupBy` puts the rows that share a key in one group, and the steps after
 * it run once per group:
 *
 * ```ts
 * computedList(() => store.tasks)
 *   .filter((task) => !task.done)
 *   .groupBy((task) => task.ownerId)
 *   .map(({ key, rows }) => ({ ownerId: key, open: rows.length }));
 * ```
 *
 * A row's output object is reused while its fields are the same, so `<For>`
 * re-renders a row only when it changed. Nothing runs until the list is
 * called. Call it in every reader rather than holding on to the array it
 * returns: calling it brings the array up to date.
 */
export function computedList<
  T extends object,
  S extends Record<string, LookupSource> = Record<never, never>,
>(source: () => Iterable<T>, lookups?: S): Query<T, Lookups<S>> {
  // A lookup builds nothing until it's read, so making them all now is cheap.
  const named: Record<string, AnyLookup> = {};
  for (const [name, from] of Object.entries(lookups ?? {})) named[name] = lookupOf(from);
  return makeQuery(start(source, named, NO_UPSTREAM)) as never;
}

const NO_UPSTREAM: ReadonlyArray<() => void> = [];

/** A query over `source` with no steps yet. */
function start(source: Source<object>, lookups: Spec["lookups"], upstream: Spec["upstream"]): Spec {
  return {
    source,
    lookups,
    upstream,
    steps: [],
    order: [],
    offset: () => 0,
    limit: () => Infinity,
  };
}

type AnyLookup = SyncedLookup<unknown, object>;

function lookupOf(source: LookupSource): AnyLookup {
  if (typeof source === "function") {
    return createLookup(source as Source<object>, (doc) => (doc as { id?: unknown }).id);
  }
  return createLookup(source.from as Source<object>, source.key as (doc: object) => unknown);
}

interface Spec {
  readonly source: Source<object>;
  readonly lookups: Readonly<Record<string, AnyLookup>>;
  /** What to bring up to date before reading `source`: the groupings it reads. */
  readonly upstream: ReadonlyArray<() => void>;
  readonly steps: ReadonlyArray<Step>;
  readonly order: ReadonlyArray<{ readonly key: StepFn; readonly sign: 1 | -1 }>;
  readonly offset: () => number;
  readonly limit: () => number;
}

type StepFn = (row: unknown, lookups: Spec["lookups"]) => unknown;
interface Step {
  readonly kind: "filter" | "map";
  readonly fn: StepFn;
}

function makeQuery(spec: Spec): Query<unknown, unknown> {
  let list: (() => ReadonlyArray<unknown>) | undefined = undefined;
  const query = () => (list ??= build(spec))();
  const next = (change: Partial<Spec>) => makeQuery({ ...spec, ...change });
  return Object.assign(query, {
    filter: (fn: StepFn) => next({ steps: [...spec.steps, { kind: "filter", fn }] }),
    map: (fn: StepFn) => next({ steps: [...spec.steps, { kind: "map", fn }] }),
    groupBy: (key: StepFn) => {
      const index = groupIndex(spec, key);
      return makeQuery(start(index.groups, spec.lookups, [index.sync]));
    },
    orderBy: (key: StepFn, direction: Direction = "asc") =>
      next({ order: [...spec.order, { key, sign: direction === "desc" ? -1 : 1 }] }),
    offset: (count: number | (() => number)) => next({ offset: toCountGetter(count) }),
    limit: (count: number | (() => number)) => next({ limit: toCountGetter(count) }),
  }) as never;
}

const NO_KEY: ReadonlyArray<unknown> = [];

/** What `applySteps` returns for a row a filter dropped. */
const DROPPED: unique symbol = Symbol("dropped");

/** Run `steps` on `item`: the row they leave, or `DROPPED`. */
function applySteps(steps: Spec["steps"], lookups: Spec["lookups"], item: object): unknown {
  let row: unknown = item;
  for (let i = 0; i < steps.length; i++) {
    const { kind, fn } = steps[i]!;
    if (kind === "map") row = fn(row, lookups);
    else if (!fn(row, lookups)) return DROPPED;
  }
  return row;
}

/** Bring the upstream groupings, then the named lookups, up to date. Tracked. */
function syncAll({ upstream, lookups }: Spec): () => void {
  const used = Object.values(lookups);
  return () => {
    for (let i = 0; i < upstream.length; i++) upstream[i]!();
    for (let i = 0; i < used.length; i++) used[i]!.sync();
  };
}

/**
 * The rows `spec`'s steps leave, filed by `key`: what `groupBy` reads its
 * groups from. Each row runs its steps and its key in its own computed.
 */
function groupIndex(spec: Spec, key: StepFn) {
  const { source, lookups, steps } = spec;
  const mapped = steps.some((step) => step.kind === "map");
  function runRow(item: object, previous: RowResult<unknown, unknown> | undefined) {
    const row = applySteps(steps, lookups, item);
    if (row === DROPPED) return OUTSIDE;
    const last = previous?.member ? previous : undefined;
    const value = mapped ? sameIfEqual(last?.value, row) : row;
    const k = key(row, lookups);
    if (last !== undefined && last.value === value && sameKey(last.key, k)) return last;
    return { member: true as const, value, key: k };
  }
  return createIndex<object, unknown, unknown>(
    source,
    // As in `build`: without a `map`, track each item as a whole.
    mapped ? runRow : (item, previous) => readWholeObject(unwrap(item), runRow, item, previous),
    syncAll(spec),
  );
}

/** Whether two keys are the same `Map` key. */
function sameKey(a: unknown, b: unknown): boolean {
  // eslint-disable-next-line no-self-compare -- NaN is the one value not equal to itself
  return a === b || (a !== a && b !== b);
}

function build(spec: Spec) {
  const { source, lookups, steps, order, offset, limit } = spec;
  const mapped = steps.some((step) => step.kind === "map");

  /**
   * Run the steps on `item`. `previous` (the row's last result) comes back
   * as is when nothing it holds changed, so a rerun that moves nothing
   * allocates nothing.
   */
  function runSteps(item: object, previous: Result | undefined): Result {
    const row = applySteps(steps, lookups, item);
    if (row === DROPPED) return OUTSIDE;
    const last = previous?.member ? previous : undefined;
    // Without a `map`, the row is the source item itself.
    const value = mapped ? sameIfEqual(last?.value, row) : row;
    const key = order.length === 0 ? NO_KEY : keyOf(row, last?.key);
    if (last !== undefined && last.value === value && last.key === key) return last;
    return { member: true, value, key };
  }

  /** The row's sort key: `previous` itself if every part orders the same. */
  function keyOf(
    row: unknown,
    previous: ReadonlyArray<unknown> | undefined,
  ): ReadonlyArray<unknown> {
    let key: Array<unknown> | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value
    for (let i = 0; i < order.length; i++) {
      const part = settled(order[i]!.key(row, lookups), previous?.[i]);
      if (key !== undefined) key.push(part);
      else if (previous === undefined || !orderedSame(previous[i], part)) {
        key = previous === undefined ? [] : previous.slice(0, i);
        key.push(part);
      }
    }
    return key ?? previous!;
  }

  return createList<object, unknown, ReadonlyArray<unknown>>({
    source,
    // The list brings what its steps read up to date before each read.
    prepare: syncAll(spec),
    // Without a `map`, a row's value is the item itself, so a rerun that
    // changed nothing is invisible: track the item as a whole, which costs
    // far less memory than a signal per field.
    run: mapped
      ? runSteps
      : (item, previous) => readWholeObject(unwrap(item), runSteps, item, previous),
    compare:
      order.length === 0
        ? undefined
        : (a, b) => {
            for (let i = 0; i < order.length; i++) {
              const result = defaultCompare(a[i], b[i]);
              if (result !== 0) return result * order[i]!.sign;
            }
            return 0;
          },
    offset,
    limit,
  });
}

type Result = RowResult<unknown, ReadonlyArray<unknown>>;

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

/**
 * A fixed or reactive window bound as a getter of a whole count, read the
 * way `Array.prototype.slice` reads it. Any number is accepted here, so the
 * list below only ever sees whole counts of at least 0.
 */
function toCountGetter(count: number | (() => number)): () => number {
  if (typeof count === "function") return () => toCount(count());
  const fixed = toCount(count);
  return () => fixed;
}

/** Whole, and at least 0. NaN reads as 0, and Infinity stays Infinity. */
function toCount(value: number): number {
  return Math.max(0, Math.trunc(value) || 0);
}
