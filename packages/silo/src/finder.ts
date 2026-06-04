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

import {
  type AdapterError,
  type AdapterFailureInfo,
  NotFoundError,
  ProcessorError,
  runAdapter,
  type SiloError,
} from "./errors";
import { defaultProcessor, defaultQueryProcessor } from "./processors";
import { resolveAdapterOptions } from "./resolve";
import { applyEvent, HandleEvent, type InternalHandle } from "./transitions";

// Re-exported for the package's own tests (not part of the public root export).
export type { InternalHandle } from "./transitions";
export type { InternalState } from "./store";

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

export class Finder<M extends DocumentTypes, Q extends QueryTypes = Record<string, never>> {
  private config: DocumentStoreConfig<M, Q>;
  private batchWindowMs: number;
  private batchSize: number;
  private maxConcurrency: number | "unbounded";
  private queue: Array<QueueEntry> = [];
  private windowFiber: Fiber.RuntimeFiber<void> | undefined = undefined;
  private state: InternalState | undefined = undefined;
  private store: DocumentStore<M, Q> | undefined = undefined;

  constructor(config: DocumentStoreConfig<M, Q>) {
    this.config = config;
    this.batchWindowMs = config.batchWindowMs ?? 15;
    this.batchSize = config.batchSize ?? 60;
    this.maxConcurrency = config.maxConcurrency ?? "unbounded";
  }

  attach(state: InternalState, store: DocumentStore<M, Q>): void {
    this.state = state;
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
   * `AdapterError` either **isolate** (split & re-fetch the halves, when
   * `bisect` is supplied and the chunk holds >1 key) or fail every waiting
   * handle. The only difference between the document and query surfaces is which
   * bucket/keys to fail and how to commit.
   */
  // oxlint-disable-next-line max-params
  private settleChunk(
    run: Effect.Effect<unknown, AdapterError>,
    buckets: Map<string, Map<string, InternalHandle>>,
    type: string,
    keys: ReadonlyArray<string>,
    commit: (raw: unknown) => void,
    bisect: (() => Effect.Effect<void>) | undefined,
  ): Effect.Effect<void> {
    return run.pipe(
      Effect.flatMap((raw) => Effect.sync(() => commit(raw))),
      Effect.catchAll((error: AdapterError) =>
        bisect !== undefined && keys.length > 1
          ? bisect()
          : Effect.sync(() => this.failChunk(buckets, type, keys, error)),
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

    return this.settleChunk(
      runAdapter(
        // oxlint-disable-next-line no-array-method-this-argument -- DocumentAdapter#find, not Array#find
        (ctx) => modelConfig.adapter.find(ids, ctx),
        {
          type,
          keys: ids,
          ...resolved,
          retry: retryEnabled ? resolved.retry : Schedule.recurs(0),
          onFailure: (error, info) =>
            this.onAttemptFailed(this.state!.documents, type, ids, error, info),
        },
      ),
      this.state!.documents,
      type,
      ids,
      (raw) => this.commitDocuments(type, ids, raw, processor),
      isolate
        ? () => this.bisect(ids, (half) => this.drainDocumentChunk(type, half, false))
        : undefined,
    );
  }

  // oxlint-disable-next-line max-params
  private commitDocuments(
    type: string,
    ids: Array<string>,
    raw: unknown,
    processor: ResponseProcessor<M>,
  ): void {
    batch(() => {
      // oxlint-disable-next-line init-declarations
      let processorError: ProcessorError | undefined;
      try {
        processor(raw, this.store! as DocumentStore<M>, type as keyof M & string);
      } catch (error) {
        processorError = new ProcessorError({ type, cause: error });
      }

      const bucket = this.state!.documents.get(type);
      for (const id of ids) {
        const handle = bucket?.get(id);
        if (handle) this.settleHandle(handle, id, type, processorError);
      }
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
    if (!queryConfig) return Effect.void;

    const processor: QueryProcessor<M, Q, keyof Q & string> =
      queryConfig.processor ??
      (defaultQueryProcessor as unknown as QueryProcessor<M, Q, keyof Q & string>);
    const resolved = resolveAdapterOptions(this.config, queryConfig);
    const isolate = queryConfig.isolateFailures ?? this.config.isolateFailures ?? false;

    const paramsList = chunk.map((e) => e.params);

    const queryKeys = chunk.map((e) => e.paramsKey);
    return this.settleChunk(
      runAdapter(
        // oxlint-disable-next-line no-array-method-this-argument -- QueryAdapter#find, not Array#find
        (ctx) => queryConfig.adapter.find(paramsList, ctx),
        {
          type,
          keys: queryKeys,
          ...resolved,
          retry: retryEnabled ? resolved.retry : Schedule.recurs(0),
          onFailure: (error, info) =>
            this.onAttemptFailed(this.state!.queries, type, queryKeys, error, info),
        },
      ),
      this.state!.queries,
      type,
      queryKeys,
      (raw) => this.commitQueries(type, chunk, paramsList, raw, processor),
      isolate
        ? () => this.bisect(chunk, (half) => this.drainQueryChunk(type, half, false))
        : undefined,
    );
  }

  // oxlint-disable-next-line max-params
  private commitQueries(
    type: string,
    chunk: Array<QueryChunkEntry>,
    paramsList: ReadonlyArray<unknown>,
    raw: unknown,
    processor: QueryProcessor<M, Q, keyof Q & string>,
  ): void {
    batch(() => {
      // oxlint-disable-next-line init-declarations
      let processorError: ProcessorError | undefined;
      try {
        processor(
          raw,
          this.store!,
          type as keyof Q & string,
          paramsList as ReadonlyArray<Q[keyof Q & string]["params"]>,
        );
      } catch (error) {
        processorError = new ProcessorError({ type, cause: error });
      }

      const bucket = this.state!.queries.get(type);
      for (const { paramsKey } of chunk) {
        const handle = bucket?.get(paramsKey);
        if (handle) this.settleHandle(handle, paramsKey, type, processorError);
      }
    });
  }

  /**
   * Settle one handle after its chunk's adapter+processor ran: a processor
   * error fails it; data present → settled; still absent → not found.
   */
  // oxlint-disable-next-line max-params
  private settleHandle(
    handle: InternalHandle,
    key: string,
    type: string,
    processorError: ProcessorError | undefined,
  ): void {
    // Post-success terminal failures: a single observation, never retried.
    const terminalInfo: AdapterFailureInfo = { attempt: 1, retryable: false };
    if (processorError) {
      this.emitError(processorError, type, [key], terminalInfo);
      applyEvent(handle, HandleEvent.failed(processorError));
    } else if (handle.value === undefined) {
      const notFound = new NotFoundError({ type, key });
      this.emitError(notFound, type, [key], terminalInfo);
      applyEvent(handle, HandleEvent.failed(notFound));
    } else {
      applyEvent(handle, HandleEvent.settled());
    }
  }

  /**
   * Report one failed adapter attempt while the fetch is still retrying: notify
   * `onError` and bump each waiting handle's `failureCount` / `lastError`
   * (without ending activity). Called per attempt by `runAdapter`'s `onFailure`,
   * so an outage is observable mid-retry — `failChunk` then only settles the
   * terminal state, never re-emitting.
   */
  // oxlint-disable-next-line max-params
  private onAttemptFailed(
    buckets: Map<string, Map<string, InternalHandle>>,
    type: string,
    keys: ReadonlyArray<string>,
    error: AdapterError,
    info: AdapterFailureInfo,
  ): void {
    this.emitError(error, type, keys, info);
    batch(() => {
      const bucket = buckets.get(type);
      for (const key of keys) {
        const handle = bucket?.get(key);
        if (handle) applyEvent(handle, HandleEvent.retrying(error));
      }
    });
  }

  // oxlint-disable-next-line max-params
  private failChunk(
    buckets: Map<string, Map<string, InternalHandle>>,
    type: string,
    keys: ReadonlyArray<string>,
    error: AdapterError,
  ): void {
    // `onError` already fired per attempt (and for a deadline breach) via
    // `onAttemptFailed`; here we only settle the handles into terminal failure.
    batch(() => {
      const bucket = buckets.get(type);
      for (const key of keys) {
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
  // oxlint-disable-next-line max-params
  private emitError(
    error: SiloError,
    type: string,
    keys: ReadonlyArray<string>,
    info: AdapterFailureInfo,
  ): void {
    const { onError } = this.config;
    if (onError === undefined) return;
    try {
      onError(error, { type, keys, attempt: info.attempt, retryable: info.retryable });
    } catch {
      // A throwing telemetry callback is swallowed — observability must not
      // affect fetch state.
    }
  }
}
