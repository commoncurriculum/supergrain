// Read only the bridge's state: calling the store's `find` / `findQuery` would
// enqueue a fetch.

import {
  getSiloDevtools,
  type HandleStatus,
  type InternalHandle,
  type SiloDevtoolsBridge,
} from "@supergrain/silo/devtools";

import { type JsonNode, serialize, type SerializeOptions } from "./serialize";

export { getSiloDevtools, type SiloDevtoolsBridge };

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** Whether a snapshot entry describes a cached document or a query result. */
export type SiloEntryKind = "document" | "query";

/** One cached handle — a document keyed by id, or a query result keyed by its params. */
export interface SiloEntrySnapshot {
  /** Document id, or the stable params-key a query result is cached under. */
  readonly key: string;
  /** Coarse lifecycle: `pending` | `success` | `error`. */
  readonly status: HandleStatus;
  /** A (re)fetch is in flight. */
  readonly isFetching: boolean;
  /** A value is currently cached (even if a later refetch errored). */
  readonly hasValue: boolean;
  /** The terminal `error` field is populated. */
  readonly hasError: boolean;
  /** Failed attempts in the current fetch cycle. */
  readonly failureCount: number;
  /** When the cached value was last fetched (epoch ms), or `null`. */
  readonly fetchedAt: number | null;
  /** Serialized `value`, present only when the snapshot was asked to include it. */
  readonly value?: JsonNode;
  /** Serialized terminal `error`, present only when requested and non-empty. */
  readonly error?: JsonNode;
  /** Serialized latest attempt error (during retries), present only when requested and non-empty. */
  readonly lastError?: JsonNode;
}

/** All cached entries for one document/query type. */
export interface SiloTypeSnapshot {
  readonly type: string;
  readonly entries: ReadonlyArray<SiloEntrySnapshot>;
}

/** A complete, plain snapshot of a silo store's cache. */
export interface SiloStoreSnapshot {
  readonly documents: ReadonlyArray<SiloTypeSnapshot>;
  readonly queries: ReadonlyArray<SiloTypeSnapshot>;
  /** Entry counts per surface. */
  readonly totals: {
    readonly documents: number;
    readonly queries: number;
  };
}

export interface SnapshotOptions {
  /**
   * Whether to serialize an entry's `value` / `error`. Defaults to `false` for
   * every entry, which keeps a snapshot cheap.
   */
  readonly includeValue?: (kind: SiloEntryKind, type: string, key: string) => boolean;
  /** Forwarded to {@link serialize} for any entry whose value is included. */
  readonly serialize?: SerializeOptions;
}

/**
 * Build a {@link SiloStoreSnapshot} from a store's devtools `bridge` (get one
 * with {@link getSiloDevtools}). Reading the bridge's reactive state subscribes
 * the calling `effect()` / `tracked()` scope, so the snapshot stays live.
 */
export function snapshotSilo(
  bridge: SiloDevtoolsBridge,
  options: SnapshotOptions = {},
): SiloStoreSnapshot {
  const ctx = {
    includeValue: options.includeValue ?? (() => false),
    serializeOptions: options.serialize,
  };
  const documents = collectGroups(bridge.state.documents, bridge.documentTypes, {
    ...ctx,
    kind: "document",
  });
  const queries = collectGroups(bridge.state.queries, bridge.queryTypes, { ...ctx, kind: "query" });

  return {
    documents,
    queries,
    totals: { documents: countEntries(documents), queries: countEntries(queries) },
  };
}

interface BaseContext {
  readonly kind: SiloEntryKind;
  readonly includeValue: (kind: SiloEntryKind, type: string, key: string) => boolean;
  readonly serializeOptions: SerializeOptions | undefined;
}

interface EntryContext extends BaseContext {
  readonly type: string;
}

// Include configured-but-empty types and seeded types with no config (sideloads).
function collectGroups(
  buckets: Map<string, Map<string, InternalHandle>>,
  configuredTypes: ReadonlyArray<string>,
  ctx: BaseContext,
): Array<SiloTypeSnapshot> {
  const typeNames = new Set<string>(configuredTypes);
  for (const type of buckets.keys()) typeNames.add(type);

  const result: Array<SiloTypeSnapshot> = [];
  for (const type of typeNames) {
    result.push({ type, entries: collectEntries(buckets.get(type), { ...ctx, type }) });
  }
  result.sort((a, b) => a.type.localeCompare(b.type));
  return result;
}

function collectEntries(
  bucket: Map<string, InternalHandle> | undefined,
  ctx: EntryContext,
): Array<SiloEntrySnapshot> {
  const entries: Array<SiloEntrySnapshot> = [];
  if (!bucket) return entries;
  for (const [key, handle] of bucket.entries()) {
    entries.push(buildEntry(key, handle, ctx));
  }
  return entries;
}

function buildEntry(key: string, handle: InternalHandle, ctx: EntryContext): SiloEntrySnapshot {
  const entry: Writable<SiloEntrySnapshot> = {
    key,
    status: handle.status,
    isFetching: handle.isFetching,
    hasValue: handle.value !== undefined,
    hasError: handle.error !== undefined,
    failureCount: handle.failureCount,
    fetchedAt: handle.fetchedAt ? handle.fetchedAt.getTime() : null,
  };
  if (ctx.includeValue(ctx.kind, ctx.type, key)) {
    if (handle.value !== undefined) entry.value = serialize(handle.value, ctx.serializeOptions);
    if (handle.error !== undefined) entry.error = serialize(handle.error, ctx.serializeOptions);
    if (handle.lastError !== undefined && handle.lastError !== handle.error) {
      entry.lastError = serialize(handle.lastError, ctx.serializeOptions);
    }
  }
  return entry;
}

function countEntries(groups: ReadonlyArray<SiloTypeSnapshot>): number {
  return groups.reduce((sum, group) => sum + group.entries.length, 0);
}

/** Live fetching/errored counts across a store's cache. */
export interface SiloActivity {
  readonly fetching: number;
  readonly errored: number;
}

/**
 * Tally in-flight and errored handles. Much cheaper than `snapshotSilo`: it
 * reads only `isFetching` / `status`, so a tracked caller subscribes to far
 * fewer signals. Only terminal errors (`status: "error"`) count; a failed
 * background refetch that still serves a value does not.
 */
export function siloActivity(bridge: SiloDevtoolsBridge): SiloActivity {
  const counts = { fetching: 0, errored: 0 };
  countActivity(bridge.state.documents, counts);
  countActivity(bridge.state.queries, counts);
  return counts;
}

function countActivity(
  buckets: Map<string, Map<string, InternalHandle>>,
  counts: { fetching: number; errored: number },
): void {
  for (const bucket of buckets.values()) {
    for (const handle of bucket.values()) {
      if (handle.isFetching) counts.fetching++;
      else if (handle.status === "error") counts.errored++;
    }
  }
}
