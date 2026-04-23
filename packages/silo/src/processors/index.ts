import type { QueryTypes } from "../queries";
import type { DocumentStore, DocumentTypes } from "../store";

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
 * from `@supergrain/silo/processors/json-api` for a reference
 * implementation of the JSON-API envelope.
 */
export function defaultProcessor<M extends DocumentTypes>(
  raw: unknown,
  store: DocumentStore<M>,
  type: keyof M & string,
): void {
  const docs = Array.isArray(raw) ? raw : [raw];
  for (const doc of docs) store.insertDocument(type, doc as M[keyof M & string]);
}

// =============================================================================
// defaultQueryProcessor — pair results with input params by position
// =============================================================================

/**
 * The default processor used for queries when `QueryConfig.processor` is
 * omitted.
 *
 * Assumes the adapter returns an array of results aligned 1:1 with the
 * input params (`paramsList[i]` produced `results[i]`). The processor
 * pairs them by position and calls
 * `store.insertQueryResult(type, paramsList[i], results[i])` for each.
 *
 * ```ts
 * // paramsList: [{ workspaceId: 7 }, { workspaceId: 8 }]
 * // adapter returns: [dashboardForWs7, dashboardForWs8]
 * // → insertQueryResult("dashboard", { workspaceId: 7 }, dashboardForWs7)
 * // → insertQueryResult("dashboard", { workspaceId: 8 }, dashboardForWs8)
 * ```
 *
 * This default does NOT normalize nested entities. If your query response
 * embeds documents that should populate the documents cache (so
 * `useDocument(type, id)` elsewhere benefits), write a custom processor
 * that calls `store.insertDocument(...)` for each nested entity in
 * addition to `store.insertQueryResult(...)` for the wrapper result.
 *
 * If the adapter returns a different shape (length mismatch, envelope,
 * sideloads), write a custom processor — this default only handles the
 * position-paired case.
 */
// oxlint-disable-next-line max-params
export function defaultQueryProcessor<M extends DocumentTypes, Q extends QueryTypes>(
  raw: unknown,
  store: DocumentStore<M, Q>,
  type: keyof Q & string,
  paramsList: ReadonlyArray<unknown>,
): void {
  const results = raw as ReadonlyArray<unknown>;
  for (let i = 0; i < paramsList.length; i++) {
    store.insertQueryResult(
      type,
      paramsList[i] as Q[keyof Q & string]["params"],
      results[i] as Q[keyof Q & string]["result"],
    );
  }
}
