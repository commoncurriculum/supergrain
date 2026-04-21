import type { DocumentTypes } from "./memory";
import type { DocumentStore, ModelConfig } from "./store";

// =============================================================================
// Finder — INTERNAL batching / dedup / chunking pipeline.
//
// Not exported from the package root. Constructed by `DocumentStore` in its
// own constructor; not consumer-facing. Lives in its own module for
// separation of concerns — batching machinery has nothing to do with cache
// storage or handle lifecycle.
// =============================================================================

/**
 * Internal config shape handed in by `DocumentStore`.
 *
 * Kept internal — consumers configure via `DocumentStoreConfig`, which the
 * store unpacks and forwards here.
 */
export interface FinderConfig<M extends DocumentTypes> {
  models: { [K in keyof M]: ModelConfig<M> };
  /** Batch window in ms. Default: 15. */
  batchWindowMs?: number;
  /** Max ids per adapter.find call. Default: 60. */
  batchSize?: number;
}

/**
 * Batched document finder (internal).
 *
 * Responsibilities:
 * - Buffer `find(type, id)` calls within a tick window (default 15ms)
 * - Dedup in-flight requests — concurrent `find("user", "1")` calls share one promise
 * - Chunk groups of ids at `batchSize` (default 60)
 * - Call the per-model `adapter.find(chunkIds)` once per chunk
 * - Run the per-model processor (`defaultProcessor` if omitted) — processor
 *   inserts into the store via `store.insertDocument(type, doc)`
 * - After the processor returns, look up each requested `(type, id)` via
 *   `store.findInMemory` to resolve the corresponding deferred. Not found
 *   in memory → reject that deferred with "not found"
 *
 * The adapter is free to fulfill `find(ids)` however it wants — one bulk
 * request, N parallel requests, websocket, whatever. Finder only cares
 * that it eventually returns or rejects.
 */
export class Finder<M extends DocumentTypes> {
  // Store reference is supplied at construction time (passed from
  // DocumentStore as `this`). No two-step `attachStore` ceremony.
  constructor(_config: FinderConfig<M>, _store: DocumentStore<M>) {
    throw new Error("@supergrain/document-store: Finder constructor is not yet implemented");
  }

  /**
   * Request a document. Batches with other requests in the same tick
   * window, calls the adapter, runs the processor, then looks the doc up
   * in memory to resolve the returned promise.
   *
   * Rejects if `type` is not in `config.models`, if the adapter rejects,
   * if the processor throws, or if the requested id is not present in
   * memory after the processor runs.
   */
  find<K extends keyof M & string>(_type: K, _id: string): Promise<M[K]> {
    throw new Error("@supergrain/document-store: Finder.find is not yet implemented");
  }
}
