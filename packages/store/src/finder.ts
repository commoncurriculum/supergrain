import type { DocumentTypes } from "./memory";
import type { ResponseProcessor } from "./processor";
import type { Store } from "./store";

// =============================================================================
// DocumentAdapter — per-model transport
// =============================================================================

/**
 * Talks to the API. Returns a raw response — the shape is opaque to
 * the finder. A `ResponseProcessor` (default or custom) transforms it
 * into documents.
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
// Per-model config
// =============================================================================

/**
 * Per-model wiring: the adapter that talks to the API and the
 * optional processor that normalizes its response.
 *
 * If `processor` is omitted, the finder uses `DefaultProcessor` — which
 * assumes the adapter returns a doc or an array of docs, each with its
 * own `type`/`id`. For envelopes, pass `new JsonApiProcessor()` or a
 * custom `ResponseProcessor`.
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
 * the finder first, then pass it to `new Store({ finder })`. The Store
 * constructor calls `attachStore` on this finder.
 *
 * @example
 * ```ts
 * const finder = new Finder<TypeToModel>({
 *   models: {
 *     user: { adapter: userAdapter },
 *     "card-stack": { adapter: cardStackAdapter, processor: new JsonApiProcessor() },
 *   },
 * })
 * const store = new Store<TypeToModel>({ finder })
 * ```
 */
export class Finder<M extends DocumentTypes> {
  #config: FinderConfig<M>;
  #store: Store<M> | undefined;

  constructor(config: FinderConfig<M>) {
    this.#config = config;
  }

  /**
   * Request a document. Batches with other requests in the same
   * tick window, calls the adapter, processes the response, and
   * inserts results into the store.
   *
   * Throws synchronously if called before a store has been attached.
   */
  find<K extends keyof M & string>(type: K, _id: string): Promise<M[K]> {
    if (!this.#store) {
      throw new Error(
        "@supergrain/store: store not attached. Pass the finder to new Store({...}).",
      );
    }
    if (!this.#config.models[type]) {
      throw new Error(`@supergrain/store: no model configured for type "${type}"`);
    }
    throw new Error("@supergrain/store: Finder.find is not yet implemented");
  }

  /** Attach the store. Called once by the `Store` constructor. */
  attachStore(store: Store<M>): void {
    this.#store = store;
  }
}
