import type { QueryConfig, QueryProcessor, QueryProcessorContext, QueryTypes } from "./queries";
import type {
  DocumentStore,
  DocumentStoreConfig,
  DocumentTypes,
  InternalState,
  ModelConfig,
  ProcessorContext,
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

type QueueEntry =
  | { surface: "documents"; type: string; id: string }
  | { surface: "queries"; type: string; paramsKey: string; params: unknown };

interface QueryChunkEntry {
  paramsKey: string;
  params: unknown;
}

interface ChunkContext {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  readonly waiters: ReadonlyArray<{
    readonly key: string;
    readonly handle: InternalHandle;
    readonly generation: number;
  }>;
}

interface BisectedRerun {
  readonly deadlineAt: number | undefined;
}

function resolvePipeline<P>(
  label: string,
  config: { processor?: P; processors?: ReadonlyArray<P> },
  fallback: P,
): ReadonlyArray<P> {
  if (config.processor !== undefined && config.processors !== undefined) {
    throw new Error(
      `@supergrain/silo: ${label} sets both \`processor\` and \`processors\` — supply one or the other`,
    );
  }
  return config.processors ?? [config.processor ?? fallback];
}

function resolveProcessors<M extends DocumentTypes>(
  type: string,
  modelConfig: ModelConfig<M>,
): ReadonlyArray<ResponseProcessor<M>> {
  return resolvePipeline(`model "${type}"`, modelConfig, defaultProcessor as ResponseProcessor<M>);
}

function resolveQueryProcessors<M extends DocumentTypes, Q extends QueryTypes>(
  type: string,
  queryConfig: QueryConfig<M, Q, keyof Q & string>,
): ReadonlyArray<QueryProcessor<M, Q, keyof Q & string>> {
  return resolvePipeline(
    `query "${type}"`,
    queryConfig,
    defaultQueryProcessor as unknown as QueryProcessor<M, Q, keyof Q & string>,
  );
}

export class Finder<M extends DocumentTypes, Q extends QueryTypes = Record<string, never>> {
  private config: DocumentStoreConfig<M, Q>;
  private batchWindowMs: number;
  private batchSize: number;
  readonly permits: Effect.Semaphore | undefined;
  private queue: Array<QueueEntry> = [];
  private windowFiber: Fiber.RuntimeFiber<void> | undefined = undefined;
  private state: InternalState;
  private store!: DocumentStore<M, Q>;

  constructor(config: DocumentStoreConfig<M, Q>, state: InternalState) {
    this.config = config;
    this.state = state;
    this.batchWindowMs = config.batchWindowMs ?? 15;
    this.batchSize = config.batchSize ?? 60;
    const maxConcurrency = config.maxConcurrency ?? "unbounded";
    // A zero-permit semaphore would block every attempt forever.
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
    // Resolved eagerly so a bad processor config throws at store creation.
    for (const [type, modelConfig] of Object.entries(config.models) as Array<
      [string, ModelConfig<M>]
    >) {
      resolveProcessors(type, modelConfig);
    }
    if (config.queries) {
      for (const [type, queryConfig] of Object.entries(config.queries) as Array<
        [string, QueryConfig<M, Q, keyof Q & string>]
      >) {
        resolveQueryProcessors(type, queryConfig);
      }
    }
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
        // Cleared before draining so entries queued during the drain open a new window.
        Effect.zipRight(
          Effect.sync(() => {
            this.windowFiber = undefined;
          }),
        ),
        Effect.zipRight(this.drainEffect()),
      ),
    );
  }

  drain(): Promise<void> {
    return Effect.runPromise(this.drainEffect());
  }

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

      // Unbounded on purpose: `maxConcurrency` is enforced per attempt by `permits`.
      return Effect.forEach(chunks, (chunk) => chunk, {
        concurrency: "unbounded",
        discard: true,
      });
    });
  }

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
        bisect === undefined || error.reason === "deadline"
          ? Effect.sync(() => this.failChunk(ctx, error))
          : bisect(),
      ),
      // A defect escaping here would interrupt sibling chunks and leave every
      // handle in the window fetching (e.g. a subscriber throwing during commit).
      Effect.catchAllDefect((defect) =>
        Effect.sync(() => {
          const error = defectToAdapterError(ctx.type, ctx.keys, defect);
          this.emitError(error, ctx, { attempt: 1, retryable: false });
          this.failChunk(ctx, error);
        }),
      ),
    );
  }

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
   * `deadlineAt` (epoch ms) is threaded through bisection so halves inherit the
   * remaining budget instead of re-arming a fresh deadline.
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
    // Suspended so generations and the deadline are captured when the chunk starts.
    return Effect.suspend(() => {
      const resolved = resolveAdapterOptions(this.config, overrides);
      const isolate = overrides.isolateFailures ?? this.config.isolateFailures ?? false;
      const bisectActive = isolate && entries.length > 1;
      const useBoundedDefault = bisectActive && resolved.retryIsDefault;
      const configuredRetry = useBoundedDefault ? boundedDefaultRetry : resolved.retry;
      const chunkRetry = retryEnabled ? configuredRetry : Schedule.recurs(0);

      let { deadlineAt } = args;
      let { deadline } = resolved;
      const decoded = Duration.decode(deadline);
      if (Duration.isFinite(decoded)) {
        deadlineAt ??= Date.now() + Duration.toMillis(decoded);
        deadline = Duration.millis(Math.max(0, deadlineAt - Date.now()));
      }

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
    if (!modelConfig) {
      throw new Error(`@supergrain/silo: no model "${type}" is configured`);
    }
    const processors = resolveProcessors(type, modelConfig);

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
      process: (raw) => {
        const context: ProcessorContext<M> = {
          store: this.store as DocumentStore<M>,
          type: type as keyof M & string,
          ids,
        };
        let response: unknown = raw;
        for (const processor of processors) {
          response = processor(response, context) ?? response;
        }
      },
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
    if (!queryConfig) {
      throw new Error(`@supergrain/silo: no query "${type}" is configured`);
    }

    const processors = resolveQueryProcessors(type, queryConfig);
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
      process: (raw) => {
        const context: QueryProcessorContext<M, Q, keyof Q & string> = {
          store: this.store,
          type: type as keyof Q & string,
          paramsList: paramsList as ReadonlyArray<Q[keyof Q & string]["params"]>,
        };
        let response: unknown = raw;
        for (const processor of processors) {
          response = processor(response, context) ?? response;
        }
      },
      rerun: (half, deadlineAt) => this.drainQueryChunk(type, half, { deadlineAt }),
    });
  }

  private settleCommitted(ctx: ChunkContext, processorError: ProcessorError | undefined): void {
    const terminalInfo: AdapterFailureInfo = { attempt: 1, retryable: false };

    if (processorError) {
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

  private onAttemptFailed(ctx: ChunkContext, error: AdapterError, info: AdapterFailureInfo): void {
    this.emitError(error, ctx, info);
    batch(() => {
      for (const { handle, generation } of ctx.waiters) {
        applyEvent(handle, HandleEvent.retrying(error, generation));
      }
    });
  }

  private failChunk(ctx: ChunkContext, error: AdapterError): void {
    // No emit: `onAttemptFailed` already reported every attempt.
    batch(() => {
      for (const { handle, generation } of ctx.waiters) {
        applyEvent(handle, HandleEvent.failed(error, generation));
      }
    });
  }

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
