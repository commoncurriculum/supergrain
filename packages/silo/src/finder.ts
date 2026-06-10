import type { QueryConfig, QueryProcessor, QueryTypes } from "./queries";
import type {
  DocumentStore,
  DocumentStoreConfig,
  DocumentTypes,
  InternalState,
  ModelConfig,
  ResponseProcessor,
} from "./store";

import { batch, unwrap } from "@supergrain/kernel";
import { Duration, Effect, type Fiber, Schedule } from "effect";

import {
  type AdapterError,
  defectToAdapterError,
  NotFoundError,
  type ProcessorError,
  runProcessor,
  type SiloError,
} from "./errors";
import { defaultProcessor, defaultQueryProcessor } from "./processors";
import { emitToSink, type ResilienceOptions, resolveAdapterOptions } from "./resolve";
import { boundedDefaultRetry } from "./retry";
import { type AdapterFailureInfo, runAdapter } from "./run-adapter";
import { applyEvent, HandleEvent, type InternalHandle } from "./transitions";

// =============================================================================
// Finder — INTERNAL batching / chunking pipeline, built on Effect.
//
// Not exported from the package root. Constructed in the closure of
// `createDocumentStore(config)`, once per store. `find` / `findQuery` calls
// within a `batchWindowMs` window collapse into chunked, concurrent
// `adapter.find(...)` Effects; results settle each handle through the
// statechart (`applyEvent`).
//
// An adapter receives `{ signal }` from an `AbortController` that aborts only
// when the adapter Effect is interrupted (e.g. a per-model `timeout` fires);
// thread it into `fetch` for a real network abort, or ignore it.
// =============================================================================

type QueueEntry =
  | { surface: "documents"; type: string; id: string }
  | { surface: "queries"; type: string; paramsKey: string; params: unknown };

interface QueryChunkEntry {
  paramsKey: string;
  params: unknown;
}

/**
 * Identifies one chunk's waiting handles: the type, the requested keys
 * (document ids or stringified query params), and the handles themselves,
 * each paired with the fetch **generation** captured when the chunk started —
 * settle events are stamped with it so the statechart fences out anything a
 * superseded cycle might land late. A key whose handle was dropped before the
 * chunk started has no waiter and is skipped by construction.
 */
interface ChunkContext {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  readonly waiters: ReadonlyArray<{
    readonly key: string;
    readonly handle: InternalHandle;
    readonly generation: number;
  }>;
}

/**
 * Marks a chunk as a bisected re-fetch of a failed parent: retry is disabled
 * (the parent already exhausted the schedule) and `deadlineAt` carries the
 * parent's remaining wall-clock budget.
 */
interface BisectedRerun {
  readonly deadlineAt: number | undefined;
}

export class Finder<M extends DocumentTypes, Q extends QueryTypes = Record<string, never>> {
  private config: DocumentStoreConfig<M, Q>;
  private batchWindowMs: number;
  private batchSize: number;
  // Bounds concurrent adapter *attempts* (not chunks): each attempt holds one
  // permit and releases it during retry backoff, so the cap composes across
  // batch windows and bisection recursion — and a chunk sleeping between
  // retries never starves healthy chunks of a slot. Readonly-public so
  // `store.runAdapter` shares the same cap with layered packages.
  readonly permits: Effect.Semaphore | undefined;
  private queue: Array<QueueEntry> = [];
  private windowFiber: Fiber.RuntimeFiber<void> | undefined = undefined;
  private state: InternalState;
  // Set via `attach` right after `createDocumentStore` builds the store — the
  // store needs the finder for its enqueue closures, so it can't exist yet
  // when the finder is constructed.
  private store!: DocumentStore<M, Q>;

  constructor(config: DocumentStoreConfig<M, Q>, state: InternalState) {
    this.config = config;
    this.state = state;
    this.batchWindowMs = config.batchWindowMs ?? 15;
    this.batchSize = config.batchSize ?? 60;
    const maxConcurrency = config.maxConcurrency ?? "unbounded";
    // A zero-permit semaphore would block every attempt forever — each fetch
    // would hang until the deadline mislabels it `reason: "deadline"`.
    if (
      typeof maxConcurrency === "number" &&
      (!Number.isInteger(maxConcurrency) || maxConcurrency < 1)
    ) {
      throw new Error(
        `@supergrain/silo: maxConcurrency must be a positive integer or "unbounded" — got ${maxConcurrency}`,
      );
    }
    this.permits =
      typeof maxConcurrency === "number" ? Effect.unsafeMakeSemaphore(maxConcurrency) : undefined;
  }

  attach(store: DocumentStore<M, Q>): void {
    this.store = store;
  }

  queueDocument<K extends keyof M & string>(type: K, id: string): void {
    this.queue.push({ surface: "documents", type, id });
    this.scheduleDrain();
  }

  queueQuery<K extends keyof Q & string>(type: K, paramsKey: string, params: Q[K]["params"]): void {
    this.queue.push({ surface: "queries", type, paramsKey, params });
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.windowFiber !== undefined) return;
    this.windowFiber = Effect.runFork(
      Effect.sleep(Duration.millis(this.batchWindowMs)).pipe(
        // Clear the handle before draining so entries queued during the drain
        // open a fresh window.
        Effect.zipRight(
          Effect.sync(() => {
            this.windowFiber = undefined;
          }),
        ),
        Effect.zipRight(this.drainEffect()),
      ),
    );
  }

  /**
   * Flush queued work in one pass. Exposed (non-private, returns a Promise) so
   * tests can drive it deterministically without the window. Never rejects on
   * adapter/processor failures or defects — those settle into handle state.
   * The one exception is an invariant violation (a queued type with no
   * config), which rejects loudly; `find` / `findQuery` validate at enqueue
   * time, so reaching it means a silo bug.
   */
  drain(): Promise<void> {
    return Effect.runPromise(this.drainEffect());
  }

  /** The drain as a single Effect program: group, chunk, fan out concurrently. */
  drainEffect(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const entries = this.queue.splice(0);
      if (entries.length === 0) return Effect.void;

      const documentGroups = new Map<string, Array<string>>();
      const queryGroups = new Map<string, Array<QueryChunkEntry>>();

      for (const entry of entries) {
        if (entry.surface === "documents") {
          const ids = documentGroups.get(entry.type) ?? [];
          if (!ids.includes(entry.id)) ids.push(entry.id);
          documentGroups.set(entry.type, ids);
        } else {
          const list = queryGroups.get(entry.type) ?? [];
          if (!list.some((e) => e.paramsKey === entry.paramsKey)) {
            list.push({ paramsKey: entry.paramsKey, params: entry.params });
          }
          queryGroups.set(entry.type, list);
        }
      }

      const chunks: Array<Effect.Effect<void>> = [];
      for (const [type, ids] of documentGroups) {
        for (let i = 0; i < ids.length; i += this.batchSize) {
          chunks.push(this.drainDocumentChunk(type, ids.slice(i, i + this.batchSize)));
        }
      }
      for (const [type, list] of queryGroups) {
        for (let i = 0; i < list.length; i += this.batchSize) {
          chunks.push(this.drainQueryChunk(type, list.slice(i, i + this.batchSize)));
        }
      }

      // Each chunk Effect catches all of its own failures AND defects
      // (settling handles), so the fan-out never fails or interrupts a
      // sibling. The fiber fan-out here is deliberately unbounded:
      // `maxConcurrency` bounds concurrent adapter *attempts* via the engine's
      // semaphore, which composes across windows and bisection where a
      // per-`forEach` cap cannot — and never holds a slot through backoff.
      return Effect.forEach(chunks, (chunk) => chunk, {
        concurrency: "unbounded",
        discard: true,
      });
    });
  }

  /**
   * Shared chunk pipeline: commit the raw response on success; on terminal
   * `AdapterError` either **bisect** (split & re-fetch the halves, when the
   * caller supplied a bisection) or fail every waiting handle. The only
   * difference between the document and query surfaces is how to commit.
   */
  private settleChunk(
    ctx: ChunkContext,
    plan: {
      run: Effect.Effect<unknown, AdapterError>;
      commit: (raw: unknown) => void;
      bisect?: () => Effect.Effect<void>;
    },
  ): Effect.Effect<void> {
    const { run, commit, bisect } = plan;
    return run.pipe(
      Effect.flatMap((raw) => Effect.sync(() => commit(raw))),
      Effect.catchAll((error: AdapterError) =>
        // A deadline breach is never bisected: the deadline is the caller's
        // hard stop — by the time it fires, the chunk's whole wall-clock
        // budget (threaded through bisection by `drainChunk`) is spent.
        bisect === undefined || error.reason === "deadline"
          ? Effect.sync(() => this.failChunk(ctx, error))
          : bisect(),
      ),
      // Safety net: nothing inside a chunk may escape as a defect — a defect
      // would fail the drain's fan-out, interrupt sibling chunks mid-request,
      // and strand every handle in the window on `isFetching: true`. Adapter
      // defects are already coerced by `runAdapter`; this net catches what's
      // left (a subscriber effect throwing during the commit flush) with the
      // same shared rule.
      Effect.catchAllDefect((defect) =>
        Effect.sync(() => {
          const error = defectToAdapterError(ctx.type, ctx.keys, defect);
          // `failChunk` never re-emits (the adapter path already reported per
          // attempt) — but a defect was never observed, so report it here.
          this.emitError(error, ctx, { attempt: 1, retryable: false });
          this.failChunk(ctx, error);
        }),
      ),
    );
  }

  /**
   * Split a failed chunk's keys in half and re-run each half via `rerun`, so a
   * single poison key is narrowed down (and ultimately fails alone) while its
   * healthy neighbors succeed. The halves run concurrently and never throw —
   * each settles its own handles. Concurrency is gated per adapter attempt by
   * the engine's semaphore, so recursion depth never multiplies the bound.
   */
  private bisect<K>(
    keys: ReadonlyArray<K>,
    rerun: (half: Array<K>) => Effect.Effect<void>,
  ): Effect.Effect<void> {
    const mid = Math.ceil(keys.length / 2);
    return Effect.forEach([keys.slice(0, mid), keys.slice(mid)], (half) => rerun([...half]), {
      concurrency: "unbounded",
      discard: true,
    });
  }

  /**
   * The one assembly line both surfaces share: resolve resilience, run the
   * adapter on the engine, commit through the processor, settle the handles —
   * with optional poison-key bisection. `retryEnabled` is false for bisected
   * sub-chunks: the parent chunk already exhausted the retry schedule, so the
   * halves run once (recurs(0)) purely to partition which key is the poison.
   *
   * `deadlineAt` is the wall-clock instant (epoch ms) when the chunk's
   * ORIGINAL deadline elapses. The top-level chunk computes it from the
   * resolved deadline and threads it through bisection, so re-fetched halves
   * inherit the *remaining* budget — the deadline stays the caller's hard
   * stop instead of each recursion level re-arming a fresh one.
   */
  private drainChunk<Entry>(args: {
    type: string;
    buckets: Map<string, Map<string, InternalHandle>>;
    entries: ReadonlyArray<Entry>;
    keys: ReadonlyArray<string>;
    overrides: ResilienceOptions;
    retryEnabled: boolean;
    deadlineAt: number | undefined;
    invoke: (ctx: {
      signal: AbortSignal;
    }) => Promise<unknown> | Effect.Effect<unknown, AdapterError>;
    process: (raw: unknown) => void;
    rerun: (half: Array<Entry>, deadlineAt: number | undefined) => Effect.Effect<void>;
  }): Effect.Effect<void> {
    const { type, buckets, entries, keys, overrides, retryEnabled, invoke, process, rerun } = args;
    // Suspended so the per-run state below (generations, the deadline budget)
    // is captured when the chunk actually starts, not when it is built.
    return Effect.suspend(() => {
      const resolved = resolveAdapterOptions(this.config, overrides);
      const isolate = overrides.isolateFailures ?? this.config.isolateFailures ?? false;
      const bisectActive = isolate && entries.length > 1;
      // Isolation engages only on a *terminal* failure, which the never-give-up
      // built-in default retry has none of — so an isolating chunk bounds the
      // built-in *fallback*. Provenance comes from resolution (`retryIsDefault`),
      // not reference identity, so an explicitly configured `retry` — including
      // an explicit `defaultRetry` — is honored as-is.
      const useBoundedDefault = bisectActive && resolved.retryIsDefault;
      const configuredRetry = useBoundedDefault ? boundedDefaultRetry : resolved.retry;
      const chunkRetry = retryEnabled ? configuredRetry : Schedule.recurs(0);

      // Convert the resolved deadline into a wall-clock budget shared with any
      // bisected halves; an infinite deadline has no budget to thread.
      let { deadlineAt } = args;
      let { deadline } = resolved;
      const decoded = Duration.decode(deadline);
      if (Duration.isFinite(decoded)) {
        deadlineAt ??= Date.now() + Duration.toMillis(decoded);
        deadline = Duration.millis(Math.max(0, deadlineAt - Date.now()));
      }

      // Capture each waiting handle and its fetch generation at chunk start —
      // settle events are stamped with the generation, so a late event from a
      // superseded cycle is structurally dropped by the statechart.
      const bucket = buckets.get(type);
      const waiters: Array<{ key: string; handle: InternalHandle; generation: number }> = [];
      for (const key of keys) {
        const handle = bucket?.get(key);
        if (handle) waiters.push({ key, handle, generation: unwrap(handle).generation });
      }
      const ctx: ChunkContext = { type, keys, waiters };

      return this.settleChunk(ctx, {
        run: runAdapter(invoke, {
          type,
          keys,
          retry: chunkRetry,
          timeout: resolved.timeout,
          deadline,
          retryable: resolved.retryable,
          permits: this.permits,
          onFailure: (error, info) => this.onAttemptFailed(ctx, error, info),
        }),
        commit: (raw) =>
          batch(() => {
            const processorError = runProcessor(type, () => process(raw));
            this.settleCommitted(ctx, processorError);
          }),
        bisect: bisectActive
          ? () => this.bisect(entries, (half) => rerun(half, deadlineAt))
          : undefined,
      });
    });
  }

  private drainDocumentChunk(
    type: string,
    ids: Array<string>,
    bisected?: BisectedRerun,
  ): Effect.Effect<void> {
    const modelConfig = (this.config.models as Record<string, ModelConfig<M>>)[type];
    // `find` validates the type at enqueue time, so this is unreachable short
    // of a silo bug — fail loudly rather than stranding the handles.
    if (!modelConfig) {
      throw new Error(`@supergrain/silo: no model "${type}" is configured`);
    }
    const processor: ResponseProcessor<M> =
      modelConfig.processor ?? (defaultProcessor as ResponseProcessor<M>);

    return this.drainChunk({
      type,
      buckets: this.state.documents,
      entries: ids,
      keys: ids,
      overrides: modelConfig,
      retryEnabled: bisected === undefined,
      deadlineAt: bisected?.deadlineAt,
      // oxlint-disable-next-line no-array-method-this-argument -- DocumentAdapter#find, not Array#find
      invoke: (adapterCtx) => modelConfig.adapter.find(ids, adapterCtx),
      process: (raw) => processor(raw, this.store as DocumentStore<M>, type as keyof M & string),
      rerun: (half, deadlineAt) => this.drainDocumentChunk(type, half, { deadlineAt }),
    });
  }

  private drainQueryChunk(
    type: string,
    chunk: Array<QueryChunkEntry>,
    bisected?: BisectedRerun,
  ): Effect.Effect<void> {
    const queryConfig = (
      this.config.queries as Record<string, QueryConfig<M, Q, keyof Q & string>> | undefined
    )?.[type];
    // `findQuery` validates the type at enqueue time, so this is unreachable
    // short of a silo bug — fail loudly rather than stranding the handles.
    if (!queryConfig) {
      throw new Error(`@supergrain/silo: no query "${type}" is configured`);
    }

    const processor: QueryProcessor<M, Q, keyof Q & string> =
      queryConfig.processor ??
      (defaultQueryProcessor as unknown as QueryProcessor<M, Q, keyof Q & string>);
    const paramsList = chunk.map((e) => e.params);

    return this.drainChunk({
      type,
      buckets: this.state.queries,
      entries: chunk,
      keys: chunk.map((e) => e.paramsKey),
      overrides: queryConfig,
      retryEnabled: bisected === undefined,
      deadlineAt: bisected?.deadlineAt,
      // oxlint-disable-next-line no-array-method-this-argument -- QueryAdapter#find, not Array#find
      invoke: (adapterCtx) => queryConfig.adapter.find(paramsList, adapterCtx),
      process: (raw) =>
        processor(
          raw,
          this.store,
          type as keyof Q & string,
          paramsList as ReadonlyArray<Q[keyof Q & string]["params"]>,
        ),
      rerun: (half, deadlineAt) => this.drainQueryChunk(type, half, { deadlineAt }),
    });
  }

  /**
   * Settle every handle in a committed chunk (adapter + processor already ran):
   * a processor error fails them all; a handle with data present is settled; a
   * handle still without data is not found.
   */
  private settleCommitted(ctx: ChunkContext, processorError: ProcessorError | undefined): void {
    // Post-success terminal failures: a single observation, never retried.
    const terminalInfo: AdapterFailureInfo = { attempt: 1, retryable: false };

    if (processorError) {
      // One processor throw is one failure — emit once for the whole chunk
      // (like the per-attempt adapter path), not once per key.
      this.emitError(processorError, ctx, terminalInfo);
      for (const { handle, generation } of ctx.waiters) {
        applyEvent(handle, HandleEvent.failed(processorError, generation));
      }
      return;
    }

    for (const { key, handle, generation } of ctx.waiters) {
      if (handle.value === undefined) {
        const notFound = new NotFoundError({ type: ctx.type, key });
        this.emitError(notFound, { type: ctx.type, keys: [key] }, terminalInfo);
        applyEvent(handle, HandleEvent.failed(notFound, generation));
      } else {
        applyEvent(handle, HandleEvent.settled(generation));
      }
    }
  }

  /**
   * Report one failed adapter attempt while the fetch is still retrying: notify
   * `onError` and bump each waiting handle's `failureCount` / `lastError`
   * (without ending activity). Called per attempt by `runAdapter`'s `onFailure`,
   * so an outage is observable mid-retry — `failChunk` then only settles the
   * terminal state, never re-emitting.
   */
  private onAttemptFailed(ctx: ChunkContext, error: AdapterError, info: AdapterFailureInfo): void {
    this.emitError(error, ctx, info);
    batch(() => {
      for (const { handle, generation } of ctx.waiters) {
        applyEvent(handle, HandleEvent.retrying(error, generation));
      }
    });
  }

  private failChunk(ctx: ChunkContext, error: AdapterError): void {
    // `onError` already fired per attempt (and for a deadline breach) via
    // `onAttemptFailed`; here we only settle the handles into terminal failure.
    batch(() => {
      for (const { handle, generation } of ctx.waiters) {
        applyEvent(handle, HandleEvent.failed(error, generation));
      }
    });
  }

  /**
   * Notify the optional `config.onError` sink with the failing `type` / `keys`
   * and the per-failure `info` (1-based `attempt`, whether `retryable`).
   */
  private emitError(
    error: SiloError,
    target: { type: string; keys: ReadonlyArray<string> },
    info: AdapterFailureInfo,
  ): void {
    emitToSink(this.config.onError, error, {
      type: target.type,
      keys: target.keys,
      attempt: info.attempt,
      retryable: info.retryable,
    });
  }
}
