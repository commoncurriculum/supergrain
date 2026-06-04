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
import { Duration, Effect, type Fiber } from "effect";

import {
  type AdapterError,
  NotFoundError,
  ProcessorError,
  runAdapter,
  type SiloError,
} from "./errors";
import { defaultProcessor, defaultQueryProcessor } from "./processors";
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
  private queue: Array<QueueEntry> = [];
  private windowFiber: Fiber.RuntimeFiber<void> | undefined = undefined;
  private state: InternalState | undefined = undefined;
  private store: DocumentStore<M, Q> | undefined = undefined;

  constructor(config: DocumentStoreConfig<M, Q>) {
    this.config = config;
    this.batchWindowMs = config.batchWindowMs ?? 15;
    this.batchSize = config.batchSize ?? 60;
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
      // so the fan-out never fails or interrupts a sibling. Run them concurrently.
      return Effect.forEach(chunks, (chunk) => chunk, {
        concurrency: "unbounded",
        discard: true,
      });
    });
  }

  /**
   * Shared chunk pipeline: commit the raw response on success, fail every
   * waiting handle on `AdapterError`. The only difference between the document
   * and query surfaces is which bucket/keys to fail and how to commit.
   */
  // oxlint-disable-next-line max-params
  private settleChunk(
    run: Effect.Effect<unknown, AdapterError>,
    buckets: Map<string, Map<string, InternalHandle>>,
    type: string,
    keys: ReadonlyArray<string>,
    commit: (raw: unknown) => void,
  ): Effect.Effect<void> {
    return run.pipe(
      Effect.flatMap((raw) => Effect.sync(() => commit(raw))),
      Effect.catchAll((error: AdapterError) =>
        Effect.sync(() => this.failChunk(buckets, type, keys, error)),
      ),
    );
  }

  private drainDocumentChunk(type: string, ids: Array<string>): Effect.Effect<void> {
    const modelConfig = (this.config.models as Record<string, ModelConfig<M>>)[type];
    const processor: ResponseProcessor<M> =
      modelConfig.processor ?? (defaultProcessor as ResponseProcessor<M>);

    return this.settleChunk(
      runAdapter(
        // oxlint-disable-next-line no-array-method-this-argument -- DocumentAdapter#find, not Array#find
        (ctx) => modelConfig.adapter.find(ids, ctx),
        { type, keys: ids, retry: modelConfig.retry, timeout: modelConfig.timeout },
      ),
      this.state!.documents,
      type,
      ids,
      (raw) => this.commitDocuments(type, ids, raw, processor),
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

  private drainQueryChunk(type: string, chunk: Array<QueryChunkEntry>): Effect.Effect<void> {
    const queryConfig = (
      this.config.queries as Record<string, QueryConfig<M, Q, keyof Q & string>> | undefined
    )?.[type];
    if (!queryConfig) return Effect.void;

    const processor: QueryProcessor<M, Q, keyof Q & string> =
      queryConfig.processor ??
      (defaultQueryProcessor as unknown as QueryProcessor<M, Q, keyof Q & string>);

    const paramsList = chunk.map((e) => e.params);

    const queryKeys = chunk.map((e) => e.paramsKey);
    return this.settleChunk(
      runAdapter(
        // oxlint-disable-next-line no-array-method-this-argument -- QueryAdapter#find, not Array#find
        (ctx) => queryConfig.adapter.find(paramsList, ctx),
        { type, keys: queryKeys, retry: queryConfig.retry, timeout: queryConfig.timeout },
      ),
      this.state!.queries,
      type,
      queryKeys,
      (raw) => this.commitQueries(type, chunk, paramsList, raw, processor),
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
    if (processorError) {
      this.emitError(processorError, type, [key]);
      applyEvent(handle, HandleEvent.failed(processorError));
    } else if (handle.value === undefined) {
      const notFound = new NotFoundError({ type, key });
      this.emitError(notFound, type, [key]);
      applyEvent(handle, HandleEvent.failed(notFound));
    } else {
      applyEvent(handle, HandleEvent.settled());
    }
  }

  // oxlint-disable-next-line max-params
  private failChunk(
    buckets: Map<string, Map<string, InternalHandle>>,
    type: string,
    keys: ReadonlyArray<string>,
    error: AdapterError,
  ): void {
    this.emitError(error, type, keys);
    batch(() => {
      const bucket = buckets.get(type);
      for (const key of keys) {
        const handle = bucket?.get(key);
        if (handle) applyEvent(handle, HandleEvent.failed(error));
      }
    });
  }

  /**
   * Notify the optional `config.onError` sink. A throwing telemetry callback
   * must never break the engine, so it's isolated in a try/catch.
   */
  private emitError(error: SiloError, type: string, keys: ReadonlyArray<string>): void {
    const { onError } = this.config;
    if (onError === undefined) return;
    try {
      onError(error, { type, keys });
    } catch {
      // A throwing telemetry callback is swallowed — observability must not
      // affect fetch state.
    }
  }
}
