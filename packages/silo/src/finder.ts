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
import { Effect } from "effect";

import { AdapterError, NotFoundError, ProcessorError } from "./errors";
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
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;
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
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      Effect.runFork(this.drainEffect());
    }, this.batchWindowMs);
  }

  /**
   * Flush queued work in one pass. Exposed (non-private, returns a Promise) so
   * tests can drive it deterministically without the timer. Never rejects —
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

      const jobs: Array<Effect.Effect<void>> = [];
      for (const [type, ids] of documentGroups) {
        for (let i = 0; i < ids.length; i += this.batchSize) {
          jobs.push(this.drainDocumentChunk(type, ids.slice(i, i + this.batchSize)));
        }
      }
      for (const [type, list] of queryGroups) {
        for (let i = 0; i < list.length; i += this.batchSize) {
          jobs.push(this.drainQueryChunk(type, list.slice(i, i + this.batchSize)));
        }
      }

      return Effect.forEach(jobs, (job) => job, { concurrency: "unbounded", discard: true });
    });
  }

  // oxlint-disable-next-line max-params
  private adapterEffect(
    config: { retry?: ModelConfig<M>["retry"]; timeout?: ModelConfig<M>["timeout"] },
    type: string,
    keys: ReadonlyArray<string>,
    run: Effect.Effect<unknown, AdapterError>,
  ): Effect.Effect<unknown, AdapterError> {
    let effect = run;
    if (config.timeout !== undefined) {
      effect = effect.pipe(
        Effect.timeoutFail({
          duration: config.timeout,
          onTimeout: () => new AdapterError({ type, keys, cause: new Error("adapter timed out") }),
        }),
      );
    }
    if (config.retry !== undefined) {
      effect = effect.pipe(Effect.retry(config.retry));
    }
    return effect;
  }

  private drainDocumentChunk(type: string, ids: Array<string>): Effect.Effect<void> {
    const modelConfig = (this.config.models as Record<string, ModelConfig<M>>)[type];
    const processor: ResponseProcessor<M> =
      modelConfig.processor ?? (defaultProcessor as ResponseProcessor<M>);

    return this.adapterEffect(modelConfig, type, ids, modelConfig.adapter.find(ids)).pipe(
      Effect.flatMap((raw) => Effect.sync(() => this.commitDocuments(type, ids, raw, processor))),
      Effect.catchAll((error: AdapterError) =>
        Effect.sync(() => this.failChunk(this.state!.documents, type, ids, error)),
      ),
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

    return this.adapterEffect(
      queryConfig,
      type,
      chunk.map((e) => e.paramsKey),
      queryConfig.adapter.find(paramsList),
    ).pipe(
      Effect.flatMap((raw) =>
        Effect.sync(() => this.commitQueries(type, chunk, paramsList, raw, processor)),
      ),
      Effect.catchAll((error: AdapterError) =>
        Effect.sync(() =>
          this.failChunk(
            this.state!.queries,
            type,
            chunk.map((e) => e.paramsKey),
            error,
          ),
        ),
      ),
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
      applyEvent(handle, HandleEvent.failed(processorError));
    } else if (handle.value === undefined) {
      applyEvent(handle, HandleEvent.failed(new NotFoundError({ type, key })));
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
    batch(() => {
      const bucket = buckets.get(type);
      for (const key of keys) {
        const handle = bucket?.get(key);
        if (handle) applyEvent(handle, HandleEvent.failed(error));
      }
    });
  }
}
