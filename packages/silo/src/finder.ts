import type { QueryConfig, QueryProcessor, QueryTypes } from "./queries";
import type {
  DocumentStore,
  DocumentStoreConfig,
  DocumentTypes,
  InternalState,
  ModelConfig,
  ResponseProcessor,
} from "./store";

import { batch } from "@supergrain/kernel";
import { Duration, Effect, type Fiber, Schedule } from "effect";

import { type AdapterError, NotFoundError, ProcessorError, type SiloError } from "./errors";
import { defaultProcessor, defaultQueryProcessor } from "./processors";
import { resolveAdapterOptions } from "./resolve";
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
 * Identifies one chunk's waiting handles: which surface's buckets, the type,
 * and the requested keys (document ids or stringified query params).
 */
interface ChunkContext {
  readonly buckets: Map<string, Map<string, InternalHandle>>;
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
}

/** Run a processor over a raw response, converting a throw into a `ProcessorError`. */
function runProcessor(type: string, run: () => void): ProcessorError | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return new ProcessorError({ type, cause: error });
  }
}

export class Finder<M extends DocumentTypes, Q extends QueryTypes = Record<string, never>> {
  private config: DocumentStoreConfig<M, Q>;
  private batchWindowMs: number;
  private batchSize: number;
  private maxConcurrency: number | "unbounded";
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
    this.maxConcurrency = config.maxConcurrency ?? "unbounded";
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
   * tests can drive it deterministically without the window. Never rejects —
   * all adapter/processor failures settle into handle state.
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

      // Each chunk Effect catches all of its own failures (settling handles),
      // so the fan-out never fails or interrupts a sibling. Run them
      // concurrently, capped by `maxConcurrency` (unbounded by default).
      return Effect.forEach(chunks, (chunk) => chunk, {
        concurrency: this.maxConcurrency,
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
        bisect === undefined ? Effect.sync(() => this.failChunk(ctx, error)) : bisect(),
      ),
    );
  }

  /**
   * Split a failed chunk's keys in half and re-run each half via `rerun`, so a
   * single poison key is narrowed down (and ultimately fails alone) while its
   * healthy neighbors succeed. The halves run concurrently and never throw —
   * each settles its own handles.
   */
  private bisect<K>(
    keys: ReadonlyArray<K>,
    rerun: (half: Array<K>) => Effect.Effect<void>,
  ): Effect.Effect<void> {
    const mid = Math.ceil(keys.length / 2);
    return Effect.forEach([keys.slice(0, mid), keys.slice(mid)], (half) => rerun([...half]), {
      concurrency: this.maxConcurrency,
      discard: true,
    });
  }

  // `retryEnabled` is false for bisected sub-chunks: the parent chunk already
  // exhausted the retry schedule, so the halves run once (recurs(0)) purely to
  // partition which id is the poison.
  private drainDocumentChunk(
    type: string,
    ids: Array<string>,
    retryEnabled = true,
  ): Effect.Effect<void> {
    const modelConfig = (this.config.models as Record<string, ModelConfig<M>>)[type];
    const processor: ResponseProcessor<M> =
      modelConfig.processor ?? (defaultProcessor as ResponseProcessor<M>);
    const resolved = resolveAdapterOptions(this.config, modelConfig);
    const isolate = modelConfig.isolateFailures ?? this.config.isolateFailures ?? false;
    const ctx: ChunkContext = { buckets: this.state.documents, type, keys: ids };

    return this.settleChunk(ctx, {
      run: runAdapter(
        // oxlint-disable-next-line no-array-method-this-argument -- DocumentAdapter#find, not Array#find
        (adapterCtx) => modelConfig.adapter.find(ids, adapterCtx),
        {
          type,
          keys: ids,
          ...resolved,
          retry: retryEnabled ? resolved.retry : Schedule.recurs(0),
          onFailure: (error, info) => this.onAttemptFailed(ctx, error, info),
        },
      ),
      commit: (raw) =>
        batch(() => {
          const processorError = runProcessor(type, () =>
            processor(raw, this.store as DocumentStore<M>, type as keyof M & string),
          );
          this.settleCommitted(ctx, processorError);
        }),
      bisect:
        isolate && ids.length > 1
          ? () => this.bisect(ids, (half) => this.drainDocumentChunk(type, half, false))
          : undefined,
    });
  }

  private drainQueryChunk(
    type: string,
    chunk: Array<QueryChunkEntry>,
    retryEnabled = true,
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
    const resolved = resolveAdapterOptions(this.config, queryConfig);
    const isolate = queryConfig.isolateFailures ?? this.config.isolateFailures ?? false;

    const paramsList = chunk.map((e) => e.params);
    const ctx: ChunkContext = {
      buckets: this.state.queries,
      type,
      keys: chunk.map((e) => e.paramsKey),
    };

    return this.settleChunk(ctx, {
      run: runAdapter(
        // oxlint-disable-next-line no-array-method-this-argument -- QueryAdapter#find, not Array#find
        (adapterCtx) => queryConfig.adapter.find(paramsList, adapterCtx),
        {
          type,
          keys: ctx.keys,
          ...resolved,
          retry: retryEnabled ? resolved.retry : Schedule.recurs(0),
          onFailure: (error, info) => this.onAttemptFailed(ctx, error, info),
        },
      ),
      commit: (raw) =>
        batch(() => {
          const processorError = runProcessor(type, () =>
            processor(
              raw,
              this.store,
              type as keyof Q & string,
              paramsList as ReadonlyArray<Q[keyof Q & string]["params"]>,
            ),
          );
          this.settleCommitted(ctx, processorError);
        }),
      bisect:
        isolate && chunk.length > 1
          ? () => this.bisect(chunk, (half) => this.drainQueryChunk(type, half, false))
          : undefined,
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
    const bucket = ctx.buckets.get(ctx.type);
    for (const key of ctx.keys) {
      // A missing handle was dropped while the fetch was in flight — skip it.
      const handle = bucket?.get(key);
      if (handle && processorError) {
        this.emitError(processorError, { type: ctx.type, keys: [key] }, terminalInfo);
        applyEvent(handle, HandleEvent.failed(processorError));
      } else if (handle && handle.value === undefined) {
        const notFound = new NotFoundError({ type: ctx.type, key });
        this.emitError(notFound, { type: ctx.type, keys: [key] }, terminalInfo);
        applyEvent(handle, HandleEvent.failed(notFound));
      } else if (handle) {
        applyEvent(handle, HandleEvent.settled());
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
      const bucket = ctx.buckets.get(ctx.type);
      for (const key of ctx.keys) {
        const handle = bucket?.get(key);
        if (handle) applyEvent(handle, HandleEvent.retrying(error));
      }
    });
  }

  private failChunk(ctx: ChunkContext, error: AdapterError): void {
    // `onError` already fired per attempt (and for a deadline breach) via
    // `onAttemptFailed`; here we only settle the handles into terminal failure.
    batch(() => {
      const bucket = ctx.buckets.get(ctx.type);
      for (const key of ctx.keys) {
        const handle = bucket?.get(key);
        if (handle) applyEvent(handle, HandleEvent.failed(error));
      }
    });
  }

  /**
   * Notify the optional `config.onError` sink with the failing `type` / `keys`
   * and the per-failure `info` (1-based `attempt`, whether `retryable`). A
   * throwing telemetry callback must never break the engine, so it's isolated.
   */
  private emitError(
    error: SiloError,
    target: { type: string; keys: ReadonlyArray<string> },
    info: AdapterFailureInfo,
  ): void {
    const { onError } = this.config;
    if (onError === undefined) return;
    try {
      onError(error, {
        type: target.type,
        keys: target.keys,
        attempt: info.attempt,
        retryable: info.retryable,
      });
    } catch {
      // A throwing telemetry callback is swallowed — observability must not
      // affect fetch state.
    }
  }
}
