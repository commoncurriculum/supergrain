// Framework-agnostic snapshot of a silo `DocumentStore`, built from the
// devtools bridge it exposes (`@supergrain/silo/devtools`).
//
// Reading the bridge's reactive `state` here is what makes the inspector live:
// when this runs inside a kernel `effect()` / `tracked()` scope, iterating the
// document/query maps subscribes to structural changes and reading each
// handle's fields subscribes to those fields — so a view re-renders exactly
// when the store changes, with no manual wiring. Crucially it never calls the
// store's `find` / `findQuery`, so inspecting can't enqueue a fetch.

import {
  getSiloDevtools,
  type HandleStatus,
  type InternalHandle,
  type SiloDevtoolsBridge,
} from "@supergrain/silo/devtools";

import { type JsonNode, serialize, type SerializeOptions } from "./serialize";

export { getSiloDevtools, type SiloDevtoolsBridge };

/** Strip `readonly` so the snapshot builder can attach optional fields in place. */
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
  /** Entry counts per surface — drives the tab labels. */
  readonly totals: {
    readonly documents: number;
    readonly queries: number;
  };
}

export interface SnapshotOptions {
  /**
   * Predicate deciding whether to serialize an entry's `value` / `error`.
   * Returning `false` (the default for every entry) keeps a snapshot cheap —
   * the list only needs scalar status. A devtools view passes a predicate that
   * matches just the entry the user has expanded.
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

// Union of configured types and types that actually hold entries, so a
// configured-but-empty type still shows up and a seeded type with no model
// config (sideloads) isn't dropped. Kept module-scope (and flat) so the
// document/query loops don't nest past the linter's depth ceiling.
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
  // Mutable builder: `value` / `error` / `lastError` are attached only when
  // present and requested, so a list snapshot stays scalar-cheap.
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
    // Serialize only what's actually present — an empty handle has no value to
    // show, so the detail view can fall back to "No value cached." rather than
    // rendering a bare `undefined`.
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

/** Live fetching/errored counts across a store's cache — cheap enough for an
 * always-mounted indicator. */
export interface SiloActivity {
  readonly fetching: number;
  readonly errored: number;
}

/**
 * Tally in-flight and errored handles without building the full snapshot. The
 * collapsed status dot only needs these two numbers; routing it through
 * `snapshotSilo` would allocate the entire grouped-entry tree and subscribe a
 * tracked scope to every handle field on every cached entry. This reads only
 * `isFetching` / `status`, so the dot re-renders on far fewer signals.
 *
 * Counts a handle as errored only on a *terminal* error (`status: "error"`): a
 * stale-while-revalidate success whose refetch failed keeps serving a value and
 * shouldn't redden the dot.
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
