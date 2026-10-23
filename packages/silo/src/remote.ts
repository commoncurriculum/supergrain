import type { DocumentHandle } from "./store";

import { batch, createReactive, unwrap } from "@supergrain/kernel";
import { Effect } from "effect";

import { type AdapterError, defectToAdapterError, type SiloError } from "./errors";
import {
  type AdapterErrorSink,
  type AdapterOptionOverrides,
  emitToSink,
  resolveAdapterOptions,
} from "./resolve";
import { runAdapter } from "./run-adapter";
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
}

/**
 * A reactive remote query result: a `DocumentHandle` plus `isStale` and
 * `refetch()`. A refetch is diffed into `value` in place, so only readers of
 * the fields that changed re-render.
 */
export type RemoteQueryHandle<T, E = SiloError> = DocumentHandle<T, E> & {
  /** True when the result is older than `staleTime`, was invalidated, or hasn't loaded. */
  readonly isStale: boolean;
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
   * While observed, a result is never dropped, and a stale one refetches on
   * observe, focus, reconnect and interval. `useRemoteQuery` calls this.
   */
  observe<Params, Result>(
    query: RemoteQuery<Params, Result, Request>,
    params: Params,
    options?: RemoteQueryOptions,
  ): () => void;
  /**
   * The result for `(query, params)`: the cached one while fresh, otherwise
   * fetched. Rejects with the fetch's error. Like React Query's `fetchQuery`,
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

type RemoteHandle = InternalHandle & { isStale: boolean; refetch: () => Promise<void> };

interface Entry {
  readonly name: string;
  readonly key: string;
  readonly request: unknown;
  readonly params: unknown;
  readonly handle: RemoteHandle;
  /** One options object per mounted observer. */
  readonly observers: Set<RemoteQueryOptions>;
  /** The longest `gcTime` any observer asked for, as in React Query. */
  gcTime: number;
  controller?: AbortController;
  inFlight?: Promise<void>;
  staleTimer?: ReturnType<typeof setTimeout>;
  gcTimer?: ReturnType<typeof setTimeout>;
  interval?: { readonly every: number; readonly timer: ReturnType<typeof setInterval> };
}

const IDLE_HANDLE: RemoteQueryHandle<unknown> = Object.freeze({
  value: undefined,
  error: undefined,
  isFetching: false,
  fetchedAt: undefined,
  failureCount: 0,
  lastError: undefined,
  status: "pending" as const,
  promise: undefined,
  isStale: false,
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

  // An option's value for an entry: the store's, unless an observer overrides
  // it. Across observers, the most eager setting wins, as in React Query.
  function staleTimeOf(entry: Entry): number {
    const times = [...entry.observers].map((options) => options.staleTime);
    const overrides = times.filter((time) => time !== undefined);
    return overrides.length > 0 ? Math.min(...overrides) : (config.staleTime ?? defaults.staleTime);
  }

  function refetchesOn(entry: Entry, trigger: "refetchOnWindowFocus" | "refetchOnReconnect") {
    return [...entry.observers].some(
      (options) => options[trigger] ?? config[trigger] ?? defaults[trigger],
    );
  }

  function intervalOf(entry: Entry): number | undefined {
    const intervals = [...entry.observers]
      .map(
        (options) => options.refetchInterval ?? config.refetchInterval ?? defaults.refetchInterval,
      )
      .filter((interval) => interval !== false);
    return intervals.length > 0 ? Math.min(...intervals) : undefined;
  }

  function markStale(entry: Entry): void {
    clearTimeout(entry.staleTimer);
    entry.staleTimer = undefined;
    if (!unwrap(entry.handle).isStale) entry.handle.isStale = true;
  }

  function markFresh(entry: Entry): void {
    clearTimeout(entry.staleTimer);
    const staleTime = staleTimeOf(entry);
    if (staleTime <= 0) {
      markStale(entry);
      return;
    }
    if (unwrap(entry.handle).isStale) entry.handle.isStale = false;
    if (Number.isFinite(staleTime)) {
      entry.staleTimer = setTimeout(() => markStale(entry), staleTime);
    }
  }

  function scheduleGc(entry: Entry): void {
    clearTimeout(entry.gcTimer);
    if (!Number.isFinite(entry.gcTime)) return;
    entry.gcTimer = setTimeout(() => {
      if (entry.observers.size > 0) return;
      entry.controller?.abort();
      clearTimeout(entry.staleTimer);
      entries.get(entry.name)?.delete(entry.key);
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

  function report(entry: Entry, error: SiloError, info: { attempt: number; retryable: boolean }) {
    emitToSink(config.onError, error, { type: entry.name, keys: [entry.key], ...info });
  }

  // Single-flight: a new fetch aborts the one in flight. Every event is
  // stamped with this fetch's generation, so a superseded fetch's late result
  // is dropped by the statechart.
  function start(entry: Entry): Promise<void> {
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;
    batch(() => applyEvent(entry.handle, HandleEvent.fetch()));
    const { generation } = unwrap(entry.handle);
    const keys = [entry.key];

    const program = runAdapter((ctx) => config.fetch(entry.request as Request, entry.params, ctx), {
      type: entry.name,
      keys,
      retry: resilience.retry,
      timeout: resilience.timeout,
      deadline: resilience.deadline,
      retryable: resilience.retryable,
      onFailure: (error, info) => {
        report(entry, error, info);
        batch(() => applyEvent(entry.handle, HandleEvent.retrying(error, generation)));
      },
    }).pipe(
      Effect.flatMap((result) =>
        Effect.sync(() =>
          batch(() => {
            if (unwrap(entry.handle).generation !== generation) return;
            applyEvent(entry.handle, HandleEvent.insert(result));
            applyEvent(entry.handle, HandleEvent.settled(generation));
            markFresh(entry);
          }),
        ),
      ),
      Effect.catchAll((error: SiloError) =>
        Effect.sync(() =>
          batch(() => applyEvent(entry.handle, HandleEvent.failed(error, generation))),
        ),
      ),
      Effect.catchAllDefect((defect) =>
        Effect.sync(() => {
          const error = defectToAdapterError(entry.name, keys, defect);
          report(entry, error, { attempt: 1, retryable: false });
          batch(() => applyEvent(entry.handle, HandleEvent.failed(error, generation)));
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => batch(() => applyEvent(entry.handle, HandleEvent.aborted(generation)))),
      ),
    );

    // A superseded fetch's promise follows its replacement, so awaiting
    // `refetch()` always reflects the state the handle settled into.
    const run: Promise<void> = Effect.runPromiseExit(program, { signal: controller.signal }).then(
      () => {
        if (entry.inFlight === run) entry.inFlight = undefined;
        if (entry.controller !== controller && entry.inFlight !== undefined) return entry.inFlight;
      },
    );
    entry.inFlight = run;
    return run;
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

    const raw = Object.assign(makeIdleHandle(), {
      isStale: true,
      refetch: () => start(entry),
    });
    const entry: Entry = {
      name: query.name,
      key,
      request: query.request,
      params,
      handle: createReactive(raw) as RemoteHandle,
      observers: new Set(),
      gcTime: config.gcTime ?? defaults.gcTime,
    };
    bucket.set(key, entry);
    // Dropped after `gcTime` unless something observes it, like a result
    // fetched for a render that suspended before mounting.
    scheduleGc(entry);
    return entry;
  }

  function needsFetch(entry: Entry): boolean {
    const raw = unwrap(entry.handle);
    return !raw.isFetching && raw.value === undefined && raw.error === undefined;
  }

  function refetchObserved(trigger: "refetchOnWindowFocus" | "refetchOnReconnect"): void {
    for (const bucket of entries.values()) {
      for (const entry of bucket.values()) {
        if (
          entry.observers.size > 0 &&
          unwrap(entry.handle).isStale &&
          refetchesOn(entry, trigger)
        ) {
          void start(entry);
        }
      }
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (isPageVisible()) refetchObserved("refetchOnWindowFocus");
    });
    globalThis.addEventListener("online", () => refetchObserved("refetchOnReconnect"));
  }

  return {
    find<Params, Result>(
      query: RemoteQuery<Params, Result, Request>,
      params: Params | null | undefined,
    ): RemoteQueryHandle<Result> {
      if (params === null || params === undefined) {
        return IDLE_HANDLE as RemoteQueryHandle<Result>;
      }
      const entry = entryFor(query, params);
      if (needsFetch(entry)) void start(entry);
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
      entry.gcTime = Math.max(entry.gcTime, options.gcTime ?? entry.gcTime);
      clearTimeout(entry.gcTimer);
      updateInterval(entry);
      const raw = unwrap(entry.handle);
      if (needsFetch(entry) || (raw.isStale && !raw.isFetching)) void start(entry);
      return () => {
        if (!entry.observers.delete(observer)) return;
        updateInterval(entry);
        if (entry.observers.size === 0) scheduleGc(entry);
      };
    },

    async fetch<Params, Result>(
      query: RemoteQuery<Params, Result, Request>,
      params: Params,
    ): Promise<Result> {
      const entry = entryFor(query, params);
      const raw = unwrap(entry.handle);
      if (raw.isStale || raw.value === undefined) {
        await (raw.isFetching && entry.inFlight !== undefined ? entry.inFlight : start(entry));
      }
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
          markStale(entry);
          if (entry.observers.size > 0) void start(entry);
        }
      }
    },
  };
}
