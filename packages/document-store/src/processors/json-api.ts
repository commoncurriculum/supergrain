import type { DocumentTypes } from "../memory";
import type { DocumentStore } from "../store";

// =============================================================================
// JSON-API types
// =============================================================================

/**
 * A single-reference relationship in a JSON-API resource.
 *
 * ```ts
 * // a CardStack's planbook relationship:
 * //   cardStack.relationships.planbook = { data: { type: "planbook", id: "42" } }
 * ```
 *
 * `data` is `null` when the relationship is explicitly absent (server
 * says "no related resource"). Missing relationships should be omitted
 * from the relationships map entirely instead.
 */
export interface Relationship<
  _T extends { type: string; id: string } = { type: string; id: string },
> {
  data: { type: string; id: string } | null;
}

/**
 * A to-many relationship in a JSON-API resource.
 *
 * ```ts
 * // a Planbook's cardStacks relationship:
 * //   planbook.relationships.cardStacks = { data: [{ type: "card-stack", id: "1" }, ...] }
 * ```
 *
 * An empty `data` array means "has no related resources" (vs. an absent
 * relationship, which should be omitted from the map).
 */
export interface RelationshipArray<
  _T extends { type: string; id: string } = { type: string; id: string },
> {
  data: Array<{ type: string; id: string }>;
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
 * });
 * ```
 */
export function jsonApiProcessor<M extends DocumentTypes, T>(
  _raw: unknown,
  _store: DocumentStore<M>,
): Array<T> {
  throw new Error("@supergrain/document-store: jsonApiProcessor is not yet implemented");
}
