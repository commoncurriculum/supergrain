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
  readonly totals: {
    readonly documents: number;
    readonly queries: number;
    readonly fetching: number;
    readonly errored: number;
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
 * Build a {@link SiloStoreSnapshot} from a store reference or its bridge.
 * Returns `undefined` if `storeOrBridge` isn't a silo store with a devtools
 * bridge (e.g. an unrelated value, or a build of silo without devtools).
 */
export function snapshotSilo(
  storeOrBridge: unknown,
  options: SnapshotOptions = {},
): SiloStoreSnapshot | undefined {
  const bridge = asBridge(storeOrBridge);
  if (!bridge) return undefined;

  const includeValue = options.includeValue ?? (() => false);
  const totals: Totals = { fetching: 0, errored: 0 };
  const base = { includeValue, serializeOptions: options.serialize, totals };

  const documents = collectGroups(bridge.state.documents, bridge.documentTypes, {
    ...base,
    kind: "document",
  });
  const queries = collectGroups(bridge.state.queries, bridge.queryTypes, {
    ...base,
    kind: "query",
  });

  return {
    documents,
    queries,
    totals: {
      documents: countEntries(documents),
      queries: countEntries(queries),
      fetching: totals.fetching,
      errored: totals.errored,
    },
  };
}

interface Totals {
  fetching: number;
  errored: number;
}

interface BaseContext {
  readonly kind: SiloEntryKind;
  readonly includeValue: (kind: SiloEntryKind, type: string, key: string) => boolean;
  readonly serializeOptions: SerializeOptions | undefined;
  readonly totals: Totals;
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
  if (handle.isFetching) ctx.totals.fetching++;
  if (handle.error !== undefined) ctx.totals.errored++;

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
    entry.value = serialize(handle.value, ctx.serializeOptions);
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

function asBridge(storeOrBridge: unknown): SiloDevtoolsBridge | undefined {
  // Accept either a store (read its bridge) or a bridge directly (it has the
  // `state` + `documentTypes` shape). Lets callers pass whichever they hold.
  const viaStore = getSiloDevtools(storeOrBridge);
  if (viaStore) return viaStore;
  if (
    storeOrBridge !== null &&
    typeof storeOrBridge === "object" &&
    "state" in storeOrBridge &&
    "documentTypes" in storeOrBridge
  ) {
    return storeOrBridge as SiloDevtoolsBridge;
  }
  return undefined;
}
