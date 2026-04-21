// =============================================================================
// Model types
// =============================================================================

/**
 * Consumer-defined map of type name → model shape.
 *
 * Each key is a type string (e.g. "user", "card-stack"), each value is the
 * full model type as defined by the consumer. The library doesn't impose
 * structure on the model beyond requiring an `id: string`. The type is
 * supplied externally at every API boundary (`find(type, id)`,
 * `insertDocument(type, doc)`), so nothing in the library reads the doc's
 * own `type` field — consumers whose API omits type from documents can
 * still use this library without modification.
 *
 * @example
 * ```ts
 * type TypeToModel = {
 *   user: User;           // User need only carry `id: string`
 *   "card-stack": CardStack;
 * };
 * ```
 */
export type DocumentTypes = Record<string, { id: string }>;

// =============================================================================
// TypeRegistry — for module augmentation
// =============================================================================

/**
 * Module-augmentation registry. Consumers augment this once to tell the
 * library which `DocumentTypes` map to use, and every hook / class method
 * picks it up automatically without explicit generics at call sites.
 *
 * @example
 * ```ts
 * // in app bootstrap, once:
 * declare module "@supergrain/document-store" {
 *   interface TypeRegistry {
 *     types: TypeToModel;
 *   }
 * }
 * ```
 */
// oxlint-disable-next-line no-empty-interface
export interface TypeRegistry {}

/**
 * Resolved type map — reads from `TypeRegistry.types` if the consumer has
 * augmented it, falls back to the open `DocumentTypes` constraint otherwise.
 */
export type RegisteredTypes = TypeRegistry extends { types: infer T extends DocumentTypes }
  ? T
  : DocumentTypes;

// =============================================================================
// MemoryEngine — reactive in-memory document cache
// =============================================================================

/**
 * Reactive in-memory document cache.
 *
 * Keyed by the externally-supplied `(type, id)` pair — type is an argument to
 * every method, not a field on the doc. Writes via `insert` overwrite
 * last-write-wins. Reads via `find` are reactive — reading inside a
 * `tracked()` scope subscribes to changes at that key, so later
 * `insert` / `clear` calls re-run the scope.
 *
 * This is the storage primitive `DocumentStore` composes over. It knows
 * nothing about fetching, handles, or processors — just reactive
 * get/set/clear on a per-document key.
 */
export class MemoryEngine<M extends DocumentTypes> {
  /**
   * Insert or update a document under the given type. The doc's only
   * required field is `id: string` — type is supplied as the first arg.
   * Any reactive scopes reading `(type, doc.id)` re-run.
   */
  insert<K extends keyof M & string>(_type: K, _doc: M[K]): void {
    throw new Error("@supergrain/document-store: MemoryEngine.insert is not yet implemented");
  }

  /**
   * Read a document from memory. Reactive — reads inside a tracked scope
   * subscribe to future changes at this key (including going from undefined
   * to defined when the doc is inserted).
   */
  find<K extends keyof M & string>(_type: K, _id: string): M[K] | undefined {
    throw new Error("@supergrain/document-store: MemoryEngine.find is not yet implemented");
  }

  /**
   * Drop all documents. Reactive scopes reading any key re-run once (single
   * atomic reset, not N per-key invalidations).
   */
  clear(): void {
    throw new Error("@supergrain/document-store: MemoryEngine.clear is not yet implemented");
  }
}
