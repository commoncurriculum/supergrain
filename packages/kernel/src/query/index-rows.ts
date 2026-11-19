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

/** The rows that share one key, as `groupBy` passes them to later steps. */
export interface Group<K, R> {
  readonly key: K;
  /** The group's rows, in source order. Updated in place. */
  readonly rows: ReadonlyArray<R>;
}

interface Bucket<T, O, K> {
  readonly key: K;
  readonly rows: Array<Row<T, O, K>>;
  first: ((value?: O) => O | undefined) | undefined;
  all: Array<O> | undefined;
  group: Group<K, O> | undefined;
  listed: boolean;
  touched: boolean;
}

export function createIndex<T extends object, O, K>(
  source: () => Iterable<T>,
  run: (item: T, previous: RowResult<O, K> | undefined) => RowResult<O, K>,
  prepare?: () => void,
) {
  const feed = createRowFeed<T, O, K>(source, run);
  // Buckets are never removed: an index over ever-changing keys grows.
  const buckets = new Map<K, Bucket<T, O, K>>();
  const touched = new Scratch<Bucket<T, O, K>>();
  const values = new Scratch<unknown>();
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
    // Tracked, so the caller subscribes to the source.
    const next = feed.read();
    // Batched so effects never see a half-filed index. Nothing past
    // `feed.read()` runs user code.
    startBatch();
    try {
      feed.apply(next, file);
    } finally {
      endBatch();
    }
  }

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

  function fileRow(row: Row<T, O, K>, k: K): void {
    const bucket = bucketOf(k);
    const { rows } = bucket;
    let at = rows.length;
    if (at > 0 && rows[at - 1]!.order > row.order) at = indexOf(rows, row.order);
    rows.splice(at, 0, row);
    touch(bucket);
  }

  function unfile(row: Row<T, O, K>, k: K): void {
    const bucket = buckets.get(k)!;
    const { rows } = bucket;
    let at = indexOf(rows, row.order);
    // A row that left the source keeps a stale label, so the binary search can miss it.
    if (rows[at] !== row) at = rows.indexOf(row);
    rows.splice(at, 1);
    touch(bucket);
  }

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

  // The incremental path relies on untouched groups' first rows being unchanged.
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

  function listIn(list: Array<Bucket<T, O, K>> | undefined, bucket: Bucket<T, O, K>): void {
    bucket.listed = true;
    bucket.group ??= { key: bucket.key, rows: unwrap(allOf(bucket)) };
    list?.push(bucket);
  }

  function allOf(bucket: Bucket<T, O, K>): Array<O> {
    if (bucket.all === undefined) {
      const { rows } = bucket;
      // `Array.from({ length })` takes V8's slow generic path.
      const raw = new Array<O>(rows.length); // eslint-disable-line unicorn/no-new-array -- every slot is filled below
      for (let i = 0; i < rows.length; i++) raw[i] = unwrap(valueOf(rows[i]!));
      bucket.all = createReactive(raw) as Array<O>;
    }
    return bucket.all;
  }

  // Untracked, so the reader subscribes to the bucket, not the source.
  function synced(k: K): Bucket<T, O, K> {
    untracked(sync);
    return bucketOf(k);
  }

  return {
    sync,

    first(k: K): O | undefined {
      const bucket = synced(k);
      bucket.first ??= signal<O | undefined>(
        bucket.rows.length > 0 ? valueOf(bucket.rows[0]!) : undefined,
      ) as Bucket<T, O, K>["first"];
      return bucket.first!();
    },

    all(k: K): ReadonlyArray<O> {
      return allOf(synced(k));
    },

    // Callers must `sync` first.
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
