import type { QueryTypes } from "./queries";
import type { DocumentStoreConfig, DocumentTypes } from "./store";

// =============================================================================
// Finder — INTERNAL batching / chunking pipeline.
//
// Not exported from the package root. Constructed in the closure of
// `createDocumentStore(config)`, once per store instance. Consumers configure
// it through `DocumentStoreConfig.batchWindowMs` / `batchSize` and never see it
// directly.
//
// Dedup is NOT handled here — it lives one layer up. A second
// `store.find(type, id)` during an in-flight fetch sees a handle with
// `status === "PENDING"`, skips kickoff, and returns the existing handle. The
// Finder's queue therefore never receives duplicate keys within a batch window.
// =============================================================================

/**
 * Internal queue entry. One per `store.find` / `store.findQuery` call that
 * misses memory and needs a fetch.
 *
 * The `surface` discriminator lets the drain route each entry to the right
 * per-model or per-query config (adapter + processor).
 */
export type QueueEntry =
  | { surface: "documents"; type: string; id: string }
  | { surface: "queries"; type: string; paramsKey: string; params: unknown };

/**
 * Batched finder (internal).
 *
 * Responsibilities:
 * - Buffer `queueDocument` / `queueQuery` calls within a tick window
 *   (default 15ms).
 * - Group queued entries by `(surface, type)`, chunk each group at
 *   `batchSize` (default 60).
 * - Per chunk, await the configured adapter's `find(...)`, run the paired
 *   processor (`defaultProcessor` / `defaultQueryProcessor` if omitted),
 *   then settle handles in a `batch()`. Settlement reads each requested
 *   key's handle back through the finder's closure-captured references to
 *   determine success/failure.
 *
 * The adapter is free to fulfill `find(keys)` however it wants — one bulk
 * request, N parallel requests, websocket, whatever. The finder only cares
 * that it eventually returns or rejects.
 *
 * Internal wiring — the Finder needs two per-store references at runtime:
 * 1. The internal state tree (for handle lifecycle writes).
 * 2. The public `DocumentStore` proxy (to pass to processors, which call
 *    `store.insertDocument` / `store.insertQueryResult`).
 *
 * Both are per-store, created alongside the Finder inside
 * `createDocumentStore`'s closure. How those references reach the Finder
 * (constructor args, setter, closure capture) is an implementation choice
 * left to the real impl — not part of this stub's surface.
 */
export class Finder<M extends DocumentTypes, Q extends QueryTypes = Record<string, never>> {
  constructor(_config: DocumentStoreConfig<M, Q>) {
    throw new Error("@supergrain/document-store: Finder constructor is not yet implemented");
  }

  /**
   * Queue a document fetch. Called by `DocumentStore.find` on a cache miss,
   * immediately after the handle has been flipped to `PENDING` with a stable
   * `promise` + `resolve` / `reject` resolvers.
   *
   * The finder pushes `{ surface: "documents", type, id }` onto its queue
   * and starts a `setTimeout(drain, batchWindowMs)` if no drain is pending.
   *
   * Returns `void` — the caller already has the handle and observes
   * completion via `handle.promise` / `handle.status`.
   */
  queueDocument<K extends keyof M & string>(_type: K, _id: string): void {
    throw new Error("@supergrain/document-store: Finder.queueDocument is not yet implemented");
  }

  /**
   * Queue a query fetch. Same contract as `queueDocument`, keyed by the
   * stable-stringified params instead of an id.
   *
   * `paramsKey` is the stable stringification the store already computed for
   * cache lookup; the finder re-uses it for queue identity. `params` is the
   * original object, handed to the adapter raw (the adapter sees the object
   * shape, never the string key).
   */
  queueQuery<K extends keyof Q & string>(
    _type: K,
    _paramsKey: string,
    _params: Q[K]["params"],
  ): void {
    throw new Error("@supergrain/document-store: Finder.queueQuery is not yet implemented");
  }
}
