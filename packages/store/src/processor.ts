import type { DocumentTypes } from "./memory";
import type { Store } from "./store";

// =============================================================================
// ResponseProcessor
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
  store: Store<M>,
) => Array<T>;

// =============================================================================
// defaultProcessor — insert by type/id, no envelope
// =============================================================================

/**
 * The default processor used when `ModelConfig.processor` is omitted.
 *
 * Assumes the adapter returns either a single document or an array of
 * documents. Each document is inserted by its own `type` and `id` fields —
 * no envelope unwrapping, no sideloading.
 *
 * ```ts
 * // adapter returns: { id: "1", type: "user", ... }
 * // or:              [{ id: "1", type: "user", ... }, { id: "2", ... }]
 * ```
 *
 * If your API wraps responses in an envelope (e.g. JSON-API
 * `{ data, included }`, GraphQL `{ data: { ... } }`, REST
 * `{ results: [...] }`), pass a custom processor — see `jsonApiProcessor`
 * for a reference implementation of the JSON-API envelope.
 */
export function defaultProcessor<M extends DocumentTypes, T>(
  _raw: unknown,
  _store: Store<M>,
): Array<T> {
  throw new Error("@supergrain/store: defaultProcessor is not yet implemented");
}

// =============================================================================
// jsonApiProcessor — { data, included } envelope
// =============================================================================

/**
 * Processor for JSON-API–style responses shaped as
 * `{ data: Array<Doc>, included?: Array<Doc> }`.
 *
 * Concatenates `data + included`, inserts every document by its own
 * `type`/`id`, and returns `data` (the originally-requested documents).
 * Sideloaded `included` resources land in the store but aren't returned.
 *
 * Opt in per-model:
 *
 * ```ts
 * new Finder<M>({
 *   models: {
 *     user: { adapter: userAdapter, processor: jsonApiProcessor },
 *   },
 * })
 * ```
 */
export function jsonApiProcessor<M extends DocumentTypes, T>(
  _raw: unknown,
  _store: Store<M>,
): Array<T> {
  throw new Error("@supergrain/store: jsonApiProcessor is not yet implemented");
}
