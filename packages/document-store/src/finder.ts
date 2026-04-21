import type { DocumentTypes } from "./memory";
import type { DocumentStore } from "./store";

// =============================================================================
// DocumentAdapter — per-model transport
// =============================================================================

/**
 * Talks to the API. Returns a raw response — the shape is opaque to
 * the finder. A `ResponseProcessor` (`defaultProcessor` or a custom one)
 * transforms it into documents.
 *
 * Contract:
 * - `find` is called with a chunk of ids (at most `FinderConfig.batchSize`,
 *   default 60) grouped by type.
 * - Returns a Promise of whatever shape the API produces. The finder
 *   never inspects the raw response.
 * - Rejections reject all pending deferreds for that chunk.
 * - The finder deduplicates concurrent requests for the same id, so
 *   the adapter never sees duplicate ids within a single call.
 */
export interface DocumentAdapter {
  find(ids: Array<string>): Promise<unknown>;
}

// =============================================================================
// ResponseProcessor — raw response → documents
// =============================================================================

/**
 * Transforms a raw adapter response into documents the store can cache.
 *
 * A processor is a pure function that:
 * 1. Parses the raw response shape (opaque to the finder).
 * 2. Calls `store.insertDocument` for every document worth caching —
 *    both the requested documents and any sideloaded resources.
 * 3. Returns the array of documents matching the originally-requested
 *    ids. The finder uses this to resolve the pending `find` promises.
 *
 * Contract:
 * - Synchronous only. If you need async normalization, do it in the
 *   adapter before it returns.
 * - Must insert every document it wants cached — the finder does NOT
 *   auto-insert the returned array. Insert then return.
 * - If the processor throws, the finder rejects all pending deferreds
 *   for that chunk with the thrown error.
 * - The returned array may be empty if none of the requested ids were
 *   in the response — in that case the finder rejects the pending
 *   deferreds with a "document not found" error.
 */
export type ResponseProcessor<M extends DocumentTypes, T> = (
  raw: unknown,
  store: DocumentStore<M>,
) => Array<T>;

// =============================================================================
// Per-model config
// =============================================================================

/**
 * Per-model wiring: the adapter that talks to the API and the
 * optional processor that normalizes its response.
 *
 * If `processor` is omitted, the finder uses `defaultProcessor` — which
 * assumes the adapter returns a doc or an array of docs, each with its
 * own `type`/`id`. For envelopes (e.g. JSON-API), pass `jsonApiProcessor`
 * from `@supergrain/document-store/processors/json-api` or a custom
 * `ResponseProcessor`.
 */
export interface ModelConfig<M extends DocumentTypes, K extends keyof M> {
  adapter: DocumentAdapter;
  processor?: ResponseProcessor<M, M[K]>;
}

// =============================================================================
// Finder config
// =============================================================================

export interface FinderConfig<M extends DocumentTypes> {
  models: { [K in keyof M]: ModelConfig<M, K> };
  /** Batch window in ms. Default: 15. */
  batchWindowMs?: number;
  /** Max ids per adapter.find call. Default: 60. */
  batchSize?: number;
}

// =============================================================================
// Finder
// =============================================================================

/**
 * Batched document finder.
 *
 * Batches `find` calls within a tick window (default 15ms), deduplicates
 * in-flight requests, chunks large batches (default 60), calls the
 * per-model adapter, runs the response processor, and inserts results
 * into the store.
 *
 * Store and finder reference each other, so wiring is two-step: construct
 * the finder first, then pass it to `new DocumentStore({ finder })`. The
 * DocumentStore constructor calls `attachStore` on this finder.
 *
 * @example
 * ```ts
 * const finder = new Finder<TypeToModel>({
 *   models: {
 *     user: { adapter: userAdapter },
 *     "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
 *   },
 * });
 * const store = new DocumentStore<TypeToModel>({ finder });
 * ```
 */
export class Finder<M extends DocumentTypes> {
  #config: FinderConfig<M>;
  #store: DocumentStore<M> | undefined;

  constructor(config: FinderConfig<M>) {
    this.#config = config;
  }

  /**
   * Request a document. Batches with other requests in the same
   * tick window, calls the adapter, processes the response, and
   * inserts results into the store.
   *
   * Throws synchronously if called before a store has been attached,
   * or if `type` is not in `config.models`.
   */
  find<K extends keyof M & string>(type: K, _id: string): Promise<M[K]> {
    if (!this.#store) {
      throw new Error(
        "@supergrain/document-store: store not attached. Pass the finder to new DocumentStore({...}).",
      );
    }
    if (!this.#config.models[type]) {
      throw new Error(`@supergrain/document-store: no model configured for type "${type}"`);
    }
    throw new Error("@supergrain/document-store: Finder.find is not yet implemented");
  }

  /** Attach the store. Called once by the `DocumentStore` constructor. */
  attachStore(store: DocumentStore<M>): void {
    this.#store = store;
  }
}
