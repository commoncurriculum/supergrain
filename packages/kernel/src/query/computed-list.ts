import { noteRead } from "../render-reads";
import { defaultCompare } from "./compare";
import { createIndex, type Group } from "./index-rows";
import { createList } from "./list";
import { createLookup, type Lookup, type SyncedLookup } from "./lookup";
import {
  groupKey,
  rowRunner,
  sortKey,
  UNSORTED,
  type SortKey,
  type Step,
  type StepFn,
} from "./run-row";

/** Sort direction for {@link Sorted.orderBy}. `null`, `undefined` and `NaN` sort last ascending. */
export type Direction = "asc" | "desc";

type Source<T> = () => Iterable<T>;

/**
 * A list a {@link computedList} can look docs up in: a function returning its
 * docs (looked up by `id`), or `{ from, key }`. Annotate `key`'s parameter
 * (`key: (user: User) => user.email`): TypeScript can't infer it.
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
   * Sort by this key. A later `orderBy` breaks ties of earlier ones; equal
   * keys keep source order. Keys are numbers, strings, bigints, or arrays of them.
   */
  orderBy(key: (row: Row, lookups: L) => unknown, direction?: Direction): Sorted<Row, L>;
  /** Skip this many rows. A function is read reactively. */
  offset(count: number | (() => number)): Sorted<Row, L>;
  /** Return at most this many rows. A function is read reactively. */
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
   * Group rows that share a key into `{ key, rows }`, rows in source order,
   * groups in order of their first row. Later steps run once per group. Keys
   * compare like `Map` keys; `null` and `undefined` are keys too.
   */
  groupBy<K>(key: (row: Row, lookups: L) => K): Query<Group<K, Row>, L>;
}

/**
 * A filtered, mapped, sorted, windowed view of a reactive list that updates
 * one row at a time:
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
 * only the rows that read what changed. Steps can read other store docs (joins).
 *
 * To look docs up in a list rather than a keyed object, name it in the
 * second argument; each step gets it with `get(key)` and `getAll(key)`:
 *
 * ```ts
 * computedList(() => store.tasks, {
 *   users: () => store.users, // looked up by `id`
 *   leads: { from: () => store.users.filter((u) => u.isLead), key: (u: User) => u.email },
 * }).map((task, { users, leads }) => ({ task, owner: users.get(task.ownerId), lead: leads.get(task.leadEmail) }));
 * ```
 *
 * `groupBy` runs the later steps once per group:
 *
 * ```ts
 * computedList(() => store.tasks)
 *   .filter((task) => !task.done)
 *   .groupBy((task) => task.ownerId)
 *   .map(({ key, rows }) => ({ ownerId: key, open: rows.length }));
 * ```
 *
 * Nothing runs until the list is called. Call it in every reader rather than
 * holding on to the array it returns: calling it brings the array up to date.
 */
export function computedList<
  T extends object,
  S extends Record<string, LookupSource> = Record<never, never>,
>(source: () => Iterable<T>, lookups?: S): Query<T, Lookups<S>> {
  const named: Record<string, AnyLookup> = {};
  for (const [name, from] of Object.entries(lookups ?? {})) named[name] = lookupOf(from);
  return makeQuery(start(source, named, null)) as never;
}

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
  readonly upstream: (() => void) | null;
  readonly steps: ReadonlyArray<Step>;
  readonly order: ReadonlyArray<{ readonly key: StepFn; readonly sign: 1 | -1 }>;
  readonly offset: () => number;
  readonly limit: () => number;
}

function makeQuery(spec: Spec): Query<unknown, unknown> {
  let list: (() => ReadonlyArray<unknown>) | undefined = undefined;
  const query = () => {
    const read = (list ??= build(spec));
    noteRead(read);
    return read();
  };
  const next = (change: Partial<Spec>) => makeQuery({ ...spec, ...change });
  return Object.assign(query, {
    filter: (fn: StepFn) => next({ steps: [...spec.steps, { kind: "filter", fn }] }),
    map: (fn: StepFn) => next({ steps: [...spec.steps, { kind: "map", fn }] }),
    groupBy: (key: StepFn) => {
      const index = createIndex<object, unknown, unknown>(
        spec.source,
        rowRunner(spec.steps, spec.lookups, groupKey(key, spec.lookups)),
        prepareOf(spec),
      );
      return makeQuery(start(index.groups, spec.lookups, index.sync));
    },
    orderBy: (key: StepFn, direction: Direction = "asc") =>
      next({ order: [...spec.order, { key, sign: direction === "desc" ? -1 : 1 }] }),
    offset: (count: number | (() => number)) => next({ offset: toCountGetter(count) }),
    limit: (count: number | (() => number)) => next({ limit: toCountGetter(count) }),
  }) as never;
}

function prepareOf({ upstream, lookups }: Spec): () => void {
  const used = Object.values(lookups);
  return () => {
    upstream?.();
    // eslint-disable-next-line typescript-eslint/prefer-for-of -- runs on every list read: no iterator
    for (let i = 0; i < used.length; i++) used[i]!.sync();
  };
}

function build(spec: Spec) {
  const { source, lookups, steps, order, offset, limit } = spec;
  return createList<object, unknown, SortKey>({
    source,
    prepare: prepareOf(spec),
    run: rowRunner(
      steps,
      lookups,
      order.length === 0
        ? UNSORTED
        : sortKey(
            order.map((part) => part.key),
            lookups,
          ),
    ),
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

function toCountGetter(count: number | (() => number)): () => number {
  if (typeof count === "function") return () => toCount(count());
  const fixed = toCount(count);
  return () => fixed;
}

function toCount(value: number): number {
  return Math.max(0, Math.trunc(value) || 0);
}
