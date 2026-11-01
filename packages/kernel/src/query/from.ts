import type { Index } from "./index-by";

import { defaultCompare } from "./compare";
import { createList, toGetter } from "./list";

/** Sort direction for {@link Query.orderBy}. `null`, `undefined` and `NaN` sort last ascending. */
export type Direction = "asc" | "desc";

/** How {@link Query.join} treats a row whose key finds no doc. */
export type JoinType = "left" | "inner";

type DocOf<I> = I extends Index<unknown, infer V> ? V : never;
type KeyOf<I> = I extends Index<infer K, unknown> ? K : never;
/** `A & B` written out as one object type, so editors show it readably. */
type Merge<A, B> = {
  [P in keyof A | keyof B]: P extends keyof B ? B[P] : P extends keyof A ? A[P] : never;
};
type Joined<J, Missing> = { [P in keyof J]: DocOf<J[P]> | Missing };

/** A query you can still sort and window. Call it to read the result. */
export interface Sorted<Row, Out> {
  (): ReadonlyArray<Out>;
  /** Sort by this key, then by any earlier `orderBy` keys' ties. Rows with equal keys keep source order. */
  orderBy(key: (row: Row) => unknown, direction?: Direction): Sorted<Row, Out>;
  /** Skip this many rows. A function is read reactively. */
  offset(count: number | (() => number)): Sorted<Row, Out>;
  /** Return at most this many rows. A function is read reactively. */
  limit(count: number | (() => number)): Sorted<Row, Out>;
}

/**
 * A chain of steps over the rows of one collection. Each step sees the row as
 * the steps before it left it. Call the query to read the result.
 */
export interface Query<Row, Out> extends Sorted<Row, Out> {
  /** Keep the rows for which this returns true. */
  where(predicate: (row: Row) => boolean): Query<Row, Out>;
  /**
   * Add a field to each row: the doc in `index` whose key is `on(row)`. With
   * `"left"` (the default) the field is `undefined` when nothing matches; with
   * `"inner"` the row is dropped. Use it anywhere in the chain, and as many
   * times as you need.
   */
  join<J extends Record<string, Index<never, object>>>(
    target: J,
    on: (row: Row) => KeyOf<J[keyof J]> | null | undefined,
    type?: "left",
  ): Query<Merge<Row, Joined<J, undefined>>, Merge<Row, Joined<J, undefined>>>;
  join<J extends Record<string, Index<never, object>>>(
    target: J,
    on: (row: Row) => KeyOf<J[keyof J]> | null | undefined,
    type: "inner",
  ): Query<Merge<Row, Joined<J, never>>, Merge<Row, Joined<J, never>>>;
  join<J extends Record<string, Index<never, object>>>(
    target: J,
    on: (row: Row) => KeyOf<J[keyof J]> | null | undefined,
    type?: JoinType,
  ): Query<Merge<Row, Joined<J, undefined>>, Merge<Row, Joined<J, undefined>>>;
  /** Replace each row with what this returns. A join is a map with a lookup. */
  map<Next>(fn: (row: Row) => Next): Query<Next, Next>;
}

interface Spec {
  readonly name: string;
  readonly source: () => Iterable<object>;
  readonly steps: ReadonlyArray<Step>;
  /** Whether a join or map changed the row; if not, the output is the source item. */
  readonly projected: boolean;
  readonly order: ReadonlyArray<{ readonly key: (row: unknown) => unknown; readonly sign: 1 | -1 }>;
  readonly offset: () => number;
  readonly limit: () => number;
}

type Step =
  | { readonly kind: "where"; readonly predicate: (row: unknown) => boolean }
  | {
      readonly kind: "join";
      readonly name: string;
      readonly index: Index<unknown, object>;
      readonly on: (row: unknown) => unknown;
      readonly inner: boolean;
    }
  | { readonly kind: "map"; readonly fn: (row: unknown) => unknown };

/**
 * Start a query over one collection, named the way its rows will be:
 *
 * ```ts
 * const usersById = indexBy(() => store.users, (user) => user.id);
 *
 * const openTasks = from({ task: () => store.tasks })
 *   .where(({ task }) => !task.done)
 *   .join({ owner: usersById }, ({ task }) => task.ownerId)
 *   .where(({ owner }) => owner?.active === true)
 *   .orderBy(({ task }) => task.rank)
 *   .limit(10);
 *
 * openTasks(); // ReadonlyArray<{ task: Task; owner: User | undefined }>
 * ```
 *
 * Without a `join` or `map`, the result is the collection's own items.
 *
 * Each row runs its steps in its own computed, so a change reruns only the
 * rows that read what changed, and the list moves only those rows. A row's
 * output object is reused while its fields are the same, so `<For>` re-renders
 * a row only when its source item or a joined doc actually changes.
 *
 * Nothing runs until the query is called. Call it in every reader rather than
 * holding on to the array it returns: calling it brings the array up to date.
 */
export function from<S extends Record<string, () => Iterable<object>>>(
  source: S,
): Query<{ [P in keyof S]: ItemOf<S[P]> }, ItemOf<S[keyof S]>> {
  const [name, ...rest] = Object.keys(source);
  if (name === undefined || rest.length > 0) {
    throw new TypeError("@supergrain/kernel: from() takes one named collection.");
  }
  return makeQuery({
    name,
    source: source[name]!,
    steps: [],
    projected: false,
    order: [],
    offset: () => 0,
    limit: () => Infinity,
  }) as never;
}

type ItemOf<S> = S extends () => Iterable<infer T> ? T : never;

function makeQuery(spec: Spec): Query<unknown, unknown> {
  let list: (() => ReadonlyArray<unknown>) | undefined = undefined;
  const query = () => (list ??= build(spec))();
  const next = (change: Partial<Spec>) => makeQuery({ ...spec, ...change });
  const step = (added: Step) => [...spec.steps, added];
  return Object.assign(query, {
    where: (predicate: (row: unknown) => boolean) =>
      next({ steps: step({ kind: "where", predicate }) }),
    join: (
      target: Record<string, Index<unknown, object>>,
      on: (row: unknown) => unknown,
      type: JoinType = "left",
    ) => {
      const [joinName, ...others] = Object.keys(target);
      if (joinName === undefined || others.length > 0) {
        throw new TypeError("@supergrain/kernel: join() takes one named index.");
      }
      const index = target[joinName]!;
      return next({
        steps: step({ kind: "join", name: joinName, index, on, inner: type === "inner" }),
        projected: true,
      });
    },
    map: (fn: (row: unknown) => unknown) =>
      next({ steps: step({ kind: "map", fn }), projected: true }),
    orderBy: (key: (row: unknown) => unknown, direction: Direction = "asc") =>
      next({ order: [...spec.order, { key, sign: direction === "desc" ? -1 : 1 }] }),
    offset: (count: number | (() => number)) => next({ offset: toGetter(count, 0) }),
    limit: (count: number | (() => number)) => next({ limit: toGetter(count, Infinity) }),
  }) as never;
}

const NO_KEY: ReadonlyArray<unknown> = [];

function build({ name, source, steps, projected, order, offset, limit }: Spec) {
  return createList<object, unknown, ReadonlyArray<unknown>>({
    source,
    run: (item, previous) => {
      let row: unknown = { [name]: item };
      for (const s of steps) {
        if (s.kind === "where") {
          if (!s.predicate(row)) return { member: false };
        } else if (s.kind === "join") {
          const doc = s.index.get(s.on(row));
          if (doc === undefined && s.inner) return { member: false };
          row = { ...(row as object), [s.name]: doc };
        } else {
          row = s.fn(row);
        }
      }
      return {
        member: true,
        value: projected ? sameIfEqual(previous, row) : item,
        key: order.length === 0 ? NO_KEY : order.map(({ key }) => key(row)),
      };
    },
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

/** `previous` when `next` is a plain object with the same fields, so the row keeps its identity. */
function sameIfEqual(previous: unknown, next: unknown): unknown {
  if (!isPlainObject(previous) || !isPlainObject(next)) return next;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) return next;
  return keys.every((k) => Object.is(previous[k], next[k])) ? previous : next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
