import type { DocumentStore, DocumentTypes } from "../store";

// =============================================================================
// JSON-API types
// =============================================================================

/**
 * A single-reference relationship in a JSON-API resource.
 *
 * The `TargetModel` generic anchors the related model type for inference by
 * `useBelongsTo` — declare `planbook: Relationship<Planbook>` on your
 * model's relationships map and the hook will type its return as
 * `DocumentHandle<Planbook>` without an explicit generic at the call site.
 * `TargetModel` is phantom (never read at runtime); the `__target`
 * property exists only to keep the generic observable to the type system.
 *
 * ```ts
 * interface CardStack {
 *   relationships: {
 *     planbook: Relationship<Planbook>;
 *   };
 * }
 * // useBelongsTo(cardStack, "planbook") → DocumentHandle<Planbook>
 * ```
 *
 * `data` is `null` when the relationship is explicitly absent (server
 * says "no related resource"). Missing relationships should be omitted
 * from the relationships map entirely instead.
 */
export interface Relationship<TargetModel = unknown> {
  data: { type: string; id: string } | null;
  /** @internal phantom — anchors `TargetModel` for `useBelongsTo` inference. Never set at runtime. */
  readonly __target?: TargetModel;
}

/**
 * A to-many relationship in a JSON-API resource.
 *
 * The `TargetModel` generic anchors the related model type for inference by
 * `useHasMany` — declare `cards: RelationshipArray<Card>` on your model's
 * relationships map and the hook will type its return as
 * `ReadonlyArray<DocumentHandle<Card>>` without an explicit generic at the call site.
 * Phantom; never read at runtime.
 *
 * An empty `data` array means "has no related resources" (vs. an absent
 * relationship, which should be omitted from the map).
 */
export interface RelationshipArray<TargetModel = unknown> {
  data: Array<{ type: string; id: string }>;
  /** @internal phantom — anchors `TargetModel` for `useHasMany` inference. Never set at runtime. */
  readonly __target?: TargetModel;
}

/**
 * Helper for declaring a JSON-API document shape on a consumer model.
 *
 * ```ts
 * type CardStack = JsonApiDocument<"card-stack",
 *   { title: string; slug: string },                 // attributes
 *   { planbook: Relationship; cards: RelationshipArray }  // relationships
 * >;
 * ```
 */
export interface JsonApiDocument<
  TypeName extends string,
  Attributes,
  Relationships extends Record<string, Relationship | RelationshipArray> = Record<string, never>,
> {
  id: string;
  type: TypeName;
  attributes: Attributes;
  relationships: Relationships;
}

// =============================================================================
// jsonApiProcessor — { data, included } envelope
// =============================================================================

/**
 * Processor for JSON-API–style responses shaped as
 * `{ data: Array<Doc>, included?: Array<Doc> }`.
 *
 * Inserts every document in `data + included` into the store, keyed by the
 * doc's own `type` field from the JSON-API envelope (not by the `type`
 * argument). That's why this processor is JSON-API-specific — it relies on
 * JSON-API's contract that every resource object carries its own type. For
 * sideloads especially, the `type` argument isn't usable: `included` can
 * contain docs of many different types unrelated to what was requested.
 *
 * The `type` argument passed in is ignored here. The library still uses it
 * after the processor runs to look up requested docs in memory via
 * `store.findInMemory(type, id)` and resolve the deferreds.
 *
 * Opt in per-model:
 *
 * ```ts
 * createDocumentStore<M>(() => ({
 *   models: {
 *     user: { adapter: userAdapter, processor: jsonApiProcessor },
 *   },
 * }));
 * ```
 */
export function jsonApiProcessor<M extends DocumentTypes>(
  _raw: unknown,
  _store: DocumentStore<M>,
  _type: keyof M & string,
): void {
  throw new Error("@supergrain/document-store: jsonApiProcessor is not yet implemented");
}
