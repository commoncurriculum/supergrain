import type { QueryProcessor, QueryTypes } from "./queries";
import type { DocumentStore, DocumentStoreConfig, DocumentTypes, ResponseProcessor } from "./store";

import { batch } from "@supergrain/kernel";

import { defaultProcessor, defaultQueryProcessor } from "./processors";

// =============================================================================
// Finder — INTERNAL batching / chunking pipeline.
//
// Not exported from the package root. Constructed in the closure of
// `createDocumentStore(config)`, once per store instance. Consumers configure
// it through `DocumentStoreConfig.batchWindowMs` / `batchSize` and never see it
// directly.
// =============================================================================

export interface InternalHandle<T = unknown> {
  status: "IDLE" | "PENDING" | "SUCCESS" | "ERROR";
  data: T | undefined;
  hasData: boolean;
  isPending: boolean;
  isFetching: boolean;
  fetchedAt: Date | undefined;
  error: Error | undefined;
  promise: Promise<T> | undefined;
  resolve?: (v: T) => void;
  reject?: (e: unknown) => void;
}

export interface InternalState {
  documents: Map<string, Map<string, InternalHandle>>;
  queries: Map<string, Map<string, InternalHandle>>;
}

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
      void this.drain();
    }, this.batchWindowMs);
  }

  /**
   * Flush the queued document/query work in one pass. Called by the
   * `setTimeout(...)` scheduled in `scheduleDrain` and exposed (non-private)
   * so tests can invoke it deterministically without driving the timer.
   * Not exported from the package root.
   */
  async drain(): Promise<void> {
    const entries = this.queue.splice(0);
    if (entries.length === 0) return;

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

    const jobs: Array<Promise<void>> = [];

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

    await Promise.all(jobs);
  }

  private async drainDocumentChunk(type: string, ids: Array<string>): Promise<void> {
    const modelConfig = (
      this.config.models as Record<
        string,
        {
          adapter: { find: (ids: Array<string>) => Promise<unknown> };
          processor?: ResponseProcessor<M>;
        }
      >
    )[type];
    const processor: ResponseProcessor<M> =
      modelConfig.processor ?? (defaultProcessor as ResponseProcessor<M>);

    let raw: unknown = undefined;
    try {
      raw = await modelConfig.adapter.find(ids);
    } catch (error) {
      this.rejectDocumentChunk(type, ids, error);
      return;
    }

    try {
      batch(() => {
        processor(raw, this.store! as DocumentStore<M>, type as keyof M & string);
        const bucket = this.state!.documents.get(type);
        for (const id of ids) {
          const handle = bucket?.get(id);
          if (handle) {
            if (handle.hasData) {
              handle.status = "SUCCESS";
              handle.isPending = false;
              handle.isFetching = false;
              handle.error = undefined;
              handle.fetchedAt = new Date();
              handle.resolve?.(handle.data);
            } else {
              const err = new Error(
                `@supergrain/silo: document not found after fetch: ${type}:${id}`,
              );
              handle.status = "ERROR";
              handle.isPending = false;
              handle.isFetching = false;
              handle.error = err;
              handle.reject?.(err);
            }
            handle.resolve = undefined;
            handle.reject = undefined;
          }
        }
      });
    } catch (error) {
      this.rejectDocumentChunk(type, ids, error);
    }
  }

  private rejectDocumentChunk(type: string, ids: Array<string>, error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    batch(() => {
      const bucket = this.state!.documents.get(type);
      for (const id of ids) {
        const handle = bucket?.get(id);
        if (handle) {
          handle.status = "ERROR";
          handle.isPending = false;
          handle.isFetching = false;
          handle.error = err;
          handle.reject?.(err);
          handle.resolve = undefined;
          handle.reject = undefined;
        }
      }
    });
  }

  private async drainQueryChunk(type: string, chunk: Array<QueryChunkEntry>): Promise<void> {
    const queryConfig = (
      this.config.queries as
        | Record<
            string,
            {
              adapter: { find: (p: Array<unknown>) => Promise<unknown> };
              processor?: QueryProcessor<M, Q, keyof Q & string>;
            }
          >
        | undefined
    )?.[type];
    if (!queryConfig) return;

    const processor: QueryProcessor<M, Q, keyof Q & string> =
      queryConfig.processor ??
      (defaultQueryProcessor as unknown as QueryProcessor<M, Q, keyof Q & string>);

    const paramsList = chunk.map((e) => e.params);

    let raw: unknown = undefined;
    try {
      raw = await queryConfig.adapter.find(paramsList);
    } catch (error) {
      this.rejectQueryChunk(type, chunk, error);
      return;
    }

    try {
      batch(() => {
        processor(
          raw,
          this.store!,
          type as keyof Q & string,
          paramsList as ReadonlyArray<Q[keyof Q & string]["params"]>,
        );
        const bucket = this.state!.queries.get(type);
        for (const { paramsKey } of chunk) {
          const handle = bucket?.get(paramsKey);
          if (handle) {
            if (handle.hasData) {
              handle.status = "SUCCESS";
              handle.isPending = false;
              handle.isFetching = false;
              handle.error = undefined;
              handle.fetchedAt = new Date();
              handle.resolve?.(handle.data);
            } else {
              const err = new Error(
                `@supergrain/silo: query result not found after fetch: ${type}:${paramsKey}`,
              );
              handle.status = "ERROR";
              handle.isPending = false;
              handle.isFetching = false;
              handle.error = err;
              handle.reject?.(err);
            }
            handle.resolve = undefined;
            handle.reject = undefined;
          }
        }
      });
    } catch (error) {
      this.rejectQueryChunk(type, chunk, error);
    }
  }

  private rejectQueryChunk(type: string, chunk: Array<QueryChunkEntry>, error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    batch(() => {
      const bucket = this.state!.queries.get(type);
      for (const { paramsKey } of chunk) {
        const handle = bucket?.get(paramsKey);
        if (handle) {
          handle.status = "ERROR";
          handle.isPending = false;
          handle.isFetching = false;
          handle.error = err;
          handle.reject?.(err);
          handle.resolve = undefined;
          handle.reject = undefined;
        }
      }
    });
  }
}
