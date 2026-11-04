import type { Change, Row, RowResult } from "./row-blocks";
import type { Structure } from "./source-rows";

/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: in this hot path `for…of` allocated an iterator
 * per loop (measured with a heap profile of the list bench).
 */
import { endBatch, signal, startBatch } from "alien-signals";

import { untracked, unwrap } from "../core";
import { createReactive } from "../store";
import { spliceArray } from "../sync-array";
import { createRowFeed, fileAll } from "./row-feed";
import { Scratch } from "./scratch";

/** The rows that share one key, as `groupBy` hands them to the steps after it. */
export interface Group<K, R> {
  readonly key: K;
  /** The group's rows, in source order. Updated in place. */
  readonly rows: ReadonlyArray<R>;
}

/** The rows under one key, and what readers of that key subscribe to. */
interface Bucket<T, O, K> {
  readonly key: K;
  /** The rows with this key, in source order. */
  readonly rows: Array<Row<T, O, K>>;
  /** The first row's value. Made on first `first`. */
  first: ((value?: O) => O | undefined) | undefined;
  /** Every row's value. Made on first `all` (or when it's listed as a group). */
  all: Array<O> | undefined;
  /** The bucket as a group, made when it's first listed. Raw. */
  group: Group<K, O> | undefined;
  /** Whether it's in the list of groups. */
  listed: boolean;
  /** Whether a change this update touched it. */
  touched: boolean;
}

/**
 * A reactive index over a collection: each item's value and key come from
 * `run`, in the item's own computed (the way a list runs a row's steps), and
 * the index files each value under its key, in source order.
 *
 * A change costs the items it touched: an item added is filed under its key,
 * and an item whose key changed moves between two keys. Readers subscribe to
 * one key's signal or array, or to the list of groups, never to the index, so
 * a change wakes only the readers of what it touched.
 *
 * Under lookups (`lookup.ts`) and `groupBy` (`computed-list.ts`).
 */
export function createIndex<T extends object, O, K>(
  source: () => Iterable<T>,
  run: (item: T, previous: RowResult<O, K> | undefined) => RowResult<O, K>,
  /** Runs, tracked, at the start of each sync: brings what `run` reads up to date. */
  prepare?: () => void,
) {
  const feed = createRowFeed<T, O, K>(source, run);
  // A bucket stays while a reader holds its signal or array, even when no
  // row has its key. An index over keys that keep changing grows slowly.
  const buckets = new Map<K, Bucket<T, O, K>>();
  // Kept between updates, so an update allocates no arrays of its own.
  const touched = new Scratch<Bucket<T, O, K>>();
  const values = new Scratch<unknown>();
  /** The non-empty buckets in order of their first row, once groups were asked for. */
  let listed: Array<Bucket<T, O, K>> | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value
  let groups: Array<Group<K, O>> | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value

  function bucketOf(k: K): Bucket<T, O, K> {
    let bucket = buckets.get(k);
    if (bucket === undefined) {
      bucket = {
        key: k,
        rows: [],
        first: undefined,
        all: undefined,
        group: undefined,
        listed: false,
        touched: false,
      };
      buckets.set(k, bucket);
    }
    return bucket;
  }

  function sync(): void {
    prepare?.();
    // Tracked: the caller subscribes to the source, not to the buckets.
    const next = feed.read();
    // Batched: an effect that reads a key runs once the index is whole and
    // the feed has recorded it, not part-way through (and once, however many
    // of its keys changed). Past `feed.read()`, nothing runs user code, so
    // nothing throws.
    startBatch();
    try {
      feed.apply(next, file);
    } finally {
      endBatch();
    }
  }

  /** File every change under its key, then publish the buckets it touched. */
  function file(changes: Scratch<Change<T, O, K>>, next: Structure<T, O, K>): void {
    try {
      const refile = next.reordered;
      if (refile) {
        fileAll(changes);
        refileAll(next.list);
      } else {
        for (let i = 0; i < changes.size; i++) {
          const { row, next: result } = changes.at(i);
          if (row.applied.member) unfile(row, row.applied.key);
          row.applied = result;
          if (result.member) fileRow(row, result.key);
        }
      }
      for (let i = 0; i < touched.size; i++) publish(touched.at(i));
      if (listed !== undefined && touched.size > 0) relist(refile);
    } finally {
      touched.clear();
    }
  }

  function touch(bucket: Bucket<T, O, K>): void {
    if (!bucket.touched) {
      bucket.touched = true;
      touched.push(bucket);
    }
  }

  /** Put `row` in its key's bucket, in source order. */
  function fileRow(row: Row<T, O, K>, k: K): void {
    const bucket = bucketOf(k);
    const { rows } = bucket;
    // Rows mostly arrive at the end, so check there first.
    let at = rows.length;
    if (at > 0 && rows[at - 1]!.order > row.order) at = indexOf(rows, row.order);
    rows.splice(at, 0, row);
    touch(bucket);
  }

  function unfile(row: Row<T, O, K>, k: K): void {
    const bucket = buckets.get(k)!;
    const { rows } = bucket;
    let at = indexOf(rows, row.order);
    // A row that left the source keeps its last label, which may no longer
    // order among the others: find it by scanning.
    if (rows[at] !== row) at = rows.indexOf(row);
    rows.splice(at, 1);
    touch(bucket);
  }

  /** After the source's rows changed order, the buckets are out of order: refile every row. */
  function refileAll(list: ReadonlyArray<Row<T, O, K>>): void {
    for (const bucket of buckets.values()) {
      bucket.rows.length = 0;
      touch(bucket);
    }
    for (let i = 0; i < list.length; i++) {
      const row = list[i]!;
      if (row.applied.member) fileRow(row, row.applied.key);
    }
  }

  /** Write a touched bucket's signal and array, if anyone reads them. */
  function publish(bucket: Bucket<T, O, K>): void {
    bucket.touched = false;
    const { rows } = bucket;
    if (bucket.first !== undefined) {
      const value = rows.length > 0 ? valueOf(rows[0]!) : undefined;
      if (untracked(bucket.first) !== value) bucket.first(value);
    }
    if (bucket.all !== undefined) {
      for (let i = 0; i < rows.length; i++) values.push(unwrap(valueOf(rows[i]!)));
      const current = unwrap(bucket.all);
      spliceArray(bucket.all, current, current.length, values.items, values.size);
      values.clear();
    }
  }

  /**
   * Bring the list of groups up to date: take out the touched groups, put
   * back the ones with rows, each by its first row's place in the source.
   * Untouched groups' first rows didn't change, so they're still in order.
   */
  function relist(refile: boolean): void {
    const list = listed!;
    if (refile || touched.size > 16 + list.length / 8) {
      for (const bucket of buckets.values()) bucket.listed = false;
      list.length = 0;
      for (const bucket of buckets.values()) if (bucket.rows.length > 0) listIn(list, bucket);
      list.sort((a, b) => a.rows[0]!.order - b.rows[0]!.order);
    } else {
      for (let i = 0; i < touched.size; i++) {
        const bucket = touched.at(i);
        if (bucket.listed) {
          list.splice(list.indexOf(bucket), 1);
          bucket.listed = false;
        }
      }
      for (let i = 0; i < touched.size; i++) {
        const bucket = touched.at(i);
        if (bucket.rows.length > 0) {
          list.splice(placeOf(list, bucket.rows[0]!.order), 0, bucket);
          listIn(undefined, bucket);
        }
      }
    }
    for (let i = 0; i < list.length; i++) values.push(list[i]!.group);
    const current = unwrap(groups!);
    spliceArray(groups!, current, current.length, values.items, values.size);
    values.clear();
  }

  /** Mark `bucket` listed (pushing it onto `list`, if given), making its group on first listing. */
  function listIn(list: Array<Bucket<T, O, K>> | undefined, bucket: Bucket<T, O, K>): void {
    bucket.listed = true;
    bucket.group ??= { key: bucket.key, rows: unwrap(allOf(bucket)) };
    list?.push(bucket);
  }

  /** The bucket's array of values, made raw on first use (so making it writes nothing). */
  function allOf(bucket: Bucket<T, O, K>): Array<O> {
    if (bucket.all === undefined) {
      const { rows } = bucket;
      // Sized up front: `Array.from({ length })` takes a slow generic path.
      const raw = new Array<O>(rows.length); // eslint-disable-line unicorn/no-new-array -- every slot is filled below
      for (let i = 0; i < rows.length; i++) raw[i] = unwrap(valueOf(rows[i]!));
      bucket.all = createReactive(raw) as Array<O>;
    }
    return bucket.all;
  }

  /** The bucket for `k`, up to date. Untracked: the reader subscribes to the bucket alone. */
  function synced(k: K): Bucket<T, O, K> {
    untracked(sync);
    return bucketOf(k);
  }

  return {
    sync,

    /**
     * The first value with this key, or `undefined`. Read reactively: a
     * reader reruns only when that value changes.
     */
    first(k: K): O | undefined {
      const bucket = synced(k);
      bucket.first ??= signal<O | undefined>(
        bucket.rows.length > 0 ? valueOf(bucket.rows[0]!) : undefined,
      ) as Bucket<T, O, K>["first"];
      return bucket.first!();
    },

    /** Every value with this key, in source order: the same reactive array every time. */
    all(k: K): ReadonlyArray<O> {
      return allOf(synced(k));
    },

    /**
     * The groups, in order of their first row in the source: one reactive
     * array, updated in place. Call `sync` first.
     */
    groups(): ReadonlyArray<Group<K, O>> {
      if (groups === undefined) {
        listed = [];
        groups = createReactive([]) as Array<Group<K, O>>;
        untracked(() => relist(true));
      }
      return groups;
    },
  };
}

function valueOf<T, O, K>(row: Row<T, O, K>): O {
  return row.applied.value as O;
}

/** Where the row labelled `order` is, or goes, in `rows` (in source order). */
function indexOf<T, O, K>(rows: ReadonlyArray<Row<T, O, K>>, order: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid]!.order < order) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Where a group whose first row is labelled `order` goes in `list`. */
function placeOf<B extends { rows: ReadonlyArray<{ order: number }> }>(
  list: ReadonlyArray<B>,
  order: number,
): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (list[mid]!.rows[0]!.order < order) low = mid + 1;
    else high = mid;
  }
  return low;
}
