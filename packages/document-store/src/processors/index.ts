import type { DocumentTypes } from "../memory";
import type { DocumentStore } from "../store";

// =============================================================================
// defaultProcessor — insert by (type, id), no envelope
// =============================================================================

/**
 * The default processor used when `ModelConfig.processor` is omitted.
 *
 * Assumes the adapter returns either a single document or an array of
 * documents — the raw value IS the cacheable payload. Each document is
 * inserted under the `type` argument (the same type the caller passed to
 * `find(type, id)`), using the doc's own `id` field. No envelope
 * unwrapping, no sideloading.
 *
 * ```ts
 * // adapter returns: { id: "1", name: "Alice" }
 * // or:              [{ id: "1", ... }, { id: "2", ... }]
 * ```
 *
 * This processor doesn't read a `type` field from the doc — it uses the
 * caller's `type` argument, so APIs that don't emit `type` on documents
 * work as-is.
 *
 * If your API wraps responses in an envelope (e.g. JSON-API
 * `{ data, included }`, GraphQL `{ data: { ... } }`, REST
 * `{ results: [...] }`), pass a custom processor — see `jsonApiProcessor`
 * from `@supergrain/document-store/processors/json-api` for a reference
 * implementation of the JSON-API envelope.
 */
export function defaultProcessor<M extends DocumentTypes>(
  _raw: unknown,
  _store: DocumentStore<M>,
  _type: keyof M & string,
): void {
  throw new Error("@supergrain/document-store: defaultProcessor is not yet implemented");
}
