import type { DocumentTypes } from "../memory";
import type { DocumentStore } from "../store";

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
 * `{ results: [...] }`), pass a custom processor — see
 * `jsonApiProcessor` from `@supergrain/document-store/processors/json-api`
 * for a reference implementation of the JSON-API envelope.
 */
export function defaultProcessor<M extends DocumentTypes, T>(
  _raw: unknown,
  _store: DocumentStore<M>,
): Array<T> {
  throw new Error("@supergrain/document-store: defaultProcessor is not yet implemented");
}
