import type { DocumentTypes } from "./store";

/**
 * Store-wide hooks around every `insertDocument(type, doc)`:
 * `prepareInsert → insertDocument → afterInsert`.
 *
 * `doc` is typed `M[K]` but widens to the model union inside an
 * implementation. Narrow it with a discriminant on the doc itself
 * (`doc.type === "card-stack"`); testing the `type` argument does not narrow it.
 */
export interface StoreHooks<M extends DocumentTypes> {
  /**
   * Runs on every insert: direct calls, processor inserts (including sideloads),
   * Provider `initial` seeds, and `@supergrain/queries` result envelopes.
   *
   * - Return a doc: that doc is stored.
   * - Return nothing: the (possibly mutated) `doc` is stored.
   * - Return `null`: nothing is stored. If a `find` requested this doc, its
   *   handle fails with `NotFoundError`.
   *
   * Return docs you don't recognize unchanged. In-place edits to a new object
   * notify no one; for an object already cached, return a replacement instead.
   * A throw fails the insert (as a `ProcessorError` during a fetch).
   *
   * @example
   * ```ts
   * createDocumentStore<TypeToModel>({
   *   hooks: {
   *     prepareInsert(type, doc) {
   *       if (doc.archived) return null; // drop — never cache archived docs
   *       if (doc.type === "card-stack") migrateFromCardsInPlace(doc);
   *       doc.meta ??= {};
   *       return doc;
   *     },
   *   },
   *   models: { ... },
   * });
   * ```
   */
  prepareInsert?: <K extends keyof M & string>(type: K, doc: M[K]) => M[K] | null | void;

  /**
   * Runs after each document is stored, with the stored raw object (treat it
   * as read-only). Inside an enclosing batch, subscribers have not been
   * notified yet. Skipped when `prepareInsert` returns `null`. A throw is
   * reported to `onError` and swallowed. Inserting from here re-enters the
   * hooks, so guard against unbounded recursion.
   *
   * @example
   * ```ts
   * createDocumentStore<TypeToModel>({
   *   hooks: {
   *     // Bridge every committed Supergrain insert back into the Ember store.
   *     afterInsert: (type, doc) => emberStore.insertDocument(doc),
   *   },
   *   models: { ... },
   * });
   * ```
   */
  afterInsert?: <K extends keyof M & string>(type: K, doc: M[K]) => void;
}
