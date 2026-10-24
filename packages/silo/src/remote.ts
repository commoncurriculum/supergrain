import type { AdapterError, SiloError } from "./errors";
import type { Effect } from "effect";

import { createReactive, unwrap } from "@supergrain/kernel";

import {
  type AdapterErrorSink,
  type AdapterOptionOverrides,
  emitToSink,
  resolveAdapterOptions,
} from "./resolve";
import { runAdapter } from "./run-adapter";
import { type Flight, runSingleFlight } from "./single-flight";
import { type DocumentHandle, IDLE_HANDLE } from "./store";
import { applyEvent, HandleEvent, type InternalHandle, makeIdleHandle } from "./transitions";
import { stableStringify } from "./util";

// =============================================================================
// Remote queries — server-computed results, cached by (name, params)
// =============================================================================
//
// A remote query is a request whose result the server computes (an analytics
// report, a search). Unlike a document it isn't an entity: nothing to
// normalize, and it has its own lifecycle — stale time, garbage collection,
// refetch on focus / reconnect / interval, invalidation — modeled on React
// Query's. It lives in its own store, apart from the document store.

/**
 * A remote query definition: a `name` (the cache key's first half) and an
 * opaque `request` that the store's `fetch` turns into an HTTP call. `Params`
 * and `Result` exist only in the type.
 */
export interface RemoteQuery<Params, Result, Request = unknown> {
  readonly name: string;
  readonly request: Request;
  /** Type-only; never set at runtime. */
  readonly types?: { readonly params: Params; readonly result: Result };
}

/**
 * Define a remote query. Usually generated, one per API operation.
 *
 * @example
 * ```ts
 * export const userActivitySummary = remoteQuery<Body, Summary, Request>(
 *   "user_activity_summary",
 *   { method: "post", path: "/api/v5/analytics/user_activity_summary" },
 * );
 * ```
 */
export function remoteQuery<Params, Result, Request = unknown>(
  name: string,
  request: Request,
): RemoteQuery<Params, Result, Request> {
  return { name, request };
}

/**
 * Freshness options, named and defaulted like React Query's. Set them on the
 * store, and override them for one `useRemoteQuery` call.
 */
export interface RemoteQueryOptions {
  /** Milliseconds a result stays fresh. Default `0`: stale as soon as it lands. */
  readonly staleTime?: number;
  /** Milliseconds an unused result is kept before it is dropped. Default 5 minutes. */
  readonly gcTime?: number;
  /** Refetch stale, mounted results when the page becomes visible. Default `true`. */
  readonly refetchOnWindowFocus?: boolean;
  /** Refetch stale, mounted results when the browser comes back online. Default `true`. */
  readonly refetchOnReconnect?: boolean;
  /** Refetch mounted results every this many milliseconds while the page is visible. Default `false`. */
  readonly refetchInterval?: number | false;
}

export interface RemoteQueryStoreConfig<Request = unknown>
  extends RemoteQueryOptions, AdapterOptionOverrides {
  /**
   * Run one request. Return a `Promise` (a rejection becomes an
   * `AdapterError`) or an `Effect`. Thread `signal` into the transport: it
   * aborts when the fetch is superseded, times out, or its result is dropped.
   */
  fetch(
    request: Request,
    params: unknown,
    ctx: { signal: AbortSignal },
  ): Promise<unknown> | Effect.Effect<unknown, AdapterError>;
  /** Called on every failed attempt, like `DocumentStoreConfig.onError`. */
  readonly onError?: AdapterErrorSink;
  /**
   * What a refetched result does: `"patch"` (default) writes only the changed
   * fields into the stored result; `"replace"` swaps in the new object.
   */
  readonly onRefetch?: "patch" | "replace";
}

/**
 * A reactive remote query result: a `DocumentHandle` plus `refetch()`. A
 * refetch is diffed into `value` in place, so only readers of the fields that
 * changed re-render.
 */
export type RemoteQueryHandle<T, E = SiloError> = DocumentHandle<T, E> & {
  /** Fetch again now, superseding any fetch in flight. */
  refetch(): Promise<void>;
};

/** Every field optional, at every depth: the shape `invalidate` matches against. */
export type PartialParams<T> = T extends object ? { [K in keyof T]?: PartialParams<T[K]> } : T;

export interface RemoteQueryStore<Request = unknown> {
  /**
   * The stable handle for `(query, params)`, starting its first fetch if it
   * has none. `null` / `undefined` params give an idle handle that never
   * fetches.
   */
  find<Params, Result>(
    query: RemoteQuery<Params, Result, Request>,
    params: Params | null | undefined,
  ): RemoteQueryHandle<Result>;
  /**
   * Mark `(query, params)` as on screen until the returned function is called.
   * While observed, a result is never dropped. It refetches on every
   * `refetchInterval`, and on observe, focus and reconnect when it is older
   * than this observer's `staleTime`. `useRemoteQuery` calls this.
   */
  observe<Params, Result>(
    query: RemoteQuery<Params, Result, Request>,
    params: Params,
    options?: RemoteQueryOptions,
  ): () => void;
  /**
   * The result for `(query, params)`: the cached one while younger than the
   * store's `staleTime`, otherwise fetched. Rejects with the fetch's error. Like React Query's `fetchQuery`,
   * for code outside React.
   */
  fetch<Params, Result>(
    query: RemoteQuery<Params, Result, Request>,
    params: Params,
  ): Promise<Result>;
  /**
   * Mark every result of `query` stale, or only those whose params contain
   * `params` (React Query's partial key matching). Observed ones refetch now;
   * the rest refetch when next observed.
   */
  invalidate<Params, Result>(
    query: RemoteQuery<Params, Result, Request>,
    params?: PartialParams<Params>,
  ): void;
}

const defaults = {
  staleTime: 0,
  gcTime: 5 * 60 * 1000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchInterval: false,
} satisfies Required<RemoteQueryOptions>;

interface Entry extends Flight {
  readonly query: RemoteQuery<unknown, unknown, unknown>;
  readonly key: string;
  readonly params: unknown;
  readonly handle: InternalHandle & { refetch: () => Promise<void> };
  /** One options object per mounted observer. */
  readonly observers: Set<RemoteQueryOptions>;
  /** The longest `gcTime` any observer asked for, as in React Query. */
  gcTime: number;
  /** Set by `invalidate`: stale whatever its age, until the next result lands. */
  invalidated: boolean;
  gcTimer?: ReturnType<typeof setTimeout>;
  interval?: { readonly every: number; readonly timer: ReturnType<typeof setInterval> };
}

const IDLE_REMOTE_HANDLE: RemoteQueryHandle<unknown> = Object.freeze({
  ...IDLE_HANDLE,
  refetch: () => Promise.resolve(),
});

/**
 * True when every field of `partial` is in `params`, at every depth. Arrays
 * compare by index, like React Query's `partialMatchKey`.
 */
function containsParams(params: unknown, partial: unknown): boolean {
  if (partial === null || typeof partial !== "object") return Object.is(params, partial);
  if (params === null || typeof params !== "object") return false;
  return Object.keys(partial).every((key) =>
    containsParams(
      (params as Record<string, unknown>)[key],
      (partial as Record<string, unknown>)[key],
    ),
  );
}

function isPageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function createRemoteQueryStore<Request = unknown>(
  config: RemoteQueryStoreConfig<Request>,
): RemoteQueryStore<Request> {
  const resilience = resolveAdapterOptions(config);
  const entries = new Map<string, Map<string, Entry>>();

  let observerCount = 0;

  // One observer's setting: its own, else the store's, else React Query's default.
  function optionOf<K extends keyof RemoteQueryOptions>(
    options: RemoteQueryOptions,
    name: K,
  ): Required<RemoteQueryOptions>[K] {
    return (options[name] ?? config[name] ?? defaults[name]) as Required<RemoteQueryOptions>[K];
  }

  // Staleness is decided per observer, from its own `staleTime`, at the moment
  // it asks, as in React Query. No timer marks a result stale.
  function isStaleFor(entry: Entry, options: RemoteQueryOptions): boolean {
    const { fetchedAt } = unwrap(entry.handle);
    return (
      entry.invalidated ||
      fetchedAt === undefined ||
      Date.now() - fetchedAt.getTime() >= optionOf(options, "staleTime")
    );
  }

  // Across observers, the shortest interval wins, as in React Query.
  function intervalOf(entry: Entry): number | undefined {
    const intervals = [...entry.observers]
      .map((options) => optionOf(options, "refetchInterval"))
      .filter((interval) => interval !== false);
    return intervals.length > 0 ? Math.min(...intervals) : undefined;
  }

  function scheduleGc(entry: Entry): void {
    clearTimeout(entry.gcTimer);
    if (!Number.isFinite(entry.gcTime)) return;
    entry.gcTimer = setTimeout(() => {
      entry.controller?.abort();
      // A dropped entry's last fetch can reschedule this after a newer entry
      // took its key; that one must stay.
      const bucket = entries.get(entry.query.name)!;
      if (bucket.get(entry.key) === entry) bucket.delete(entry.key);
    }, entry.gcTime);
  }

  function updateInterval(entry: Entry): void {
    const every = intervalOf(entry);
    if (entry.interval?.every === every) return;
    clearInterval(entry.interval?.timer);
    entry.interval =
      every === undefined
        ? undefined
        : {
            every,
            timer: setInterval(() => {
              if (isPageVisible()) void start(entry);
            }, every),
          };
  }

  function start(entry: Entry): Promise<void> {
    const type = entry.query.name;
    const keys = [entry.key];
    const report = (error: SiloError, info: { attempt: number; retryable: boolean }) =>
      emitToSink(config.onError, error, { type, keys, ...info });
    return runSingleFlight(entry, {
      type,
      keys,
      run: (retrying) =>
        runAdapter((ctx) => config.fetch(entry.query.request as Request, entry.params, ctx), {
          type,
          keys,
          retry: resilience.retry,
          timeout: resilience.timeout,
          deadline: resilience.deadline,
          retryable: resilience.retryable,
          onFailure: (error, info) => {
            report(error, info);
            retrying(error);
          },
        }),
      commit: (result) => {
        applyEvent(entry.handle, HandleEvent.insert(result, config.onRefetch));
        entry.invalidated = false;
      },
      report: (error) => report(error, { attempt: 1, retryable: false }),
    }).then(() => {
      // As in React Query, an unobserved result is kept `gcTime` past its last fetch.
      if (entry.observers.size === 0) scheduleGc(entry);
    });
  }

  function entryFor(query: RemoteQuery<unknown, unknown, Request>, params: unknown): Entry {
    const key = stableStringify(params);
    let bucket = entries.get(query.name);
    if (bucket === undefined) {
      bucket = new Map();
      entries.set(query.name, bucket);
    }
    const existing = bucket.get(key);
    if (existing !== undefined) return existing;

    const raw = Object.assign(makeIdleHandle(), { refetch: () => start(entry) });
    const entry: Entry = {
      query,
      key,
      params,
      handle: createReactive(raw) as Entry["handle"],
      observers: new Set(),
      gcTime: config.gcTime ?? defaults.gcTime,
      invalidated: false,
    };
    bucket.set(key, entry);
    // Dropped after `gcTime` unless something observes it, like a result
    // fetched for a render that suspended before mounting.
    scheduleGc(entry);
    return entry;
  }

  // A result refetches when any of its observers has the trigger on and finds
  // it stale.
  function refetchObserved(trigger: "refetchOnWindowFocus" | "refetchOnReconnect"): void {
    for (const bucket of entries.values()) {
      for (const entry of bucket.values()) {
        if (
          !unwrap(entry.handle).isFetching &&
          [...entry.observers].some(
            (options) => optionOf(options, trigger) && isStaleFor(entry, options),
          )
        ) {
          void start(entry);
        }
      }
    }
  }

  const onVisibilityChange = () => {
    if (isPageVisible()) refetchObserved("refetchOnWindowFocus");
  };
  const onOnline = () => refetchObserved("refetchOnReconnect");

  return {
    find<Params, Result>(
      query: RemoteQuery<Params, Result, Request>,
      params: Params | null | undefined,
    ): RemoteQueryHandle<Result> {
      if (params === null || params === undefined) {
        return IDLE_REMOTE_HANDLE as RemoteQueryHandle<Result>;
      }
      const entry = entryFor(query, params);
      const raw = unwrap(entry.handle);
      if (!raw.isFetching && raw.value === undefined && raw.error === undefined) void start(entry);
      return entry.handle as unknown as RemoteQueryHandle<Result>;
    },

    observe<Params, Result>(
      query: RemoteQuery<Params, Result, Request>,
      params: Params,
      options: RemoteQueryOptions = {},
    ): () => void {
      const entry = entryFor(query, params);
      // A fresh object per call, so two observers with equal options count twice.
      const observer = { ...options };
      entry.observers.add(observer);
      // The page is listened to only while something is observed, so an unused
      // store holds no listeners.
      if (observerCount++ === 0 && typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibilityChange);
        globalThis.addEventListener("online", onOnline);
      }
      entry.gcTime = Math.max(entry.gcTime, options.gcTime ?? entry.gcTime);
      clearTimeout(entry.gcTimer);
      updateInterval(entry);
      if (!unwrap(entry.handle).isFetching && isStaleFor(entry, observer)) void start(entry);
      return () => {
        entry.observers.delete(observer);
        if (--observerCount === 0 && typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisibilityChange);
          globalThis.removeEventListener("online", onOnline);
        }
        updateInterval(entry);
        if (entry.observers.size === 0) scheduleGc(entry);
      };
    },

    async fetch<Params, Result>(
      query: RemoteQuery<Params, Result, Request>,
      params: Params,
    ): Promise<Result> {
      const entry = entryFor(query, params);
      if (isStaleFor(entry, {})) await (entry.inFlight ?? start(entry));
      const settled = unwrap(entry.handle);
      if (settled.error !== undefined) throw settled.error;
      return entry.handle.value as Result;
    },

    invalidate<Params, Result>(
      query: RemoteQuery<Params, Result, Request>,
      params?: PartialParams<Params>,
    ): void {
      for (const entry of entries.get(query.name)?.values() ?? []) {
        if (params === undefined || containsParams(entry.params, params)) {
          entry.invalidated = true;
          if (entry.observers.size > 0) void start(entry);
        }
      }
    },
  };
}
