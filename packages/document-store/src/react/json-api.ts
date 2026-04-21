import type { DocumentTypes, RegisteredTypes } from "../memory";
import type { Relationship, RelationshipArray } from "../processors/json-api";
import type { DocumentHandle, DocumentsHandle } from "../store";

// =============================================================================
// useBelongsTo — JSON-API single-reference relationship → reactive handle
// =============================================================================

/**
 * Resolve a JSON-API `belongsTo` relationship to a reactive document handle.
 *
 * Reads `model.relationships[relationName].data` to get the `{ type, id }`
 * reference, then calls `useDocument(type, id)` under the hood.
 *
 * `null` relationship data or a `null` model returns an idle handle.
 *
 * @example
 * ```tsx
 * const planbook = useBelongsTo(cardStack, "planbook");
 * if (planbook.isPending) return <Spinner />;
 * return <span>{planbook.data?.attributes.title}</span>;
 * ```
 */
export function useBelongsTo<
  _M extends DocumentTypes = RegisteredTypes,
  Model extends { relationships: Record<string, Relationship | RelationshipArray> } = {
    relationships: Record<string, Relationship>;
  },
  _K extends keyof Model["relationships"] = keyof Model["relationships"],
>(_model: Model | null | undefined, _relationName: _K): DocumentHandle<unknown> {
  throw new Error("@supergrain/document-store/react/json-api: useBelongsTo is not yet implemented");
}

// =============================================================================
// useHasMany — JSON-API to-many relationship → reactive handle list
// =============================================================================

/**
 * Resolve a JSON-API `hasMany` relationship to a reactive aggregate handle
 * over the related documents.
 *
 * Reads `model.relationships[relationName].data` to get the array of
 * `{ type, id }` references, then calls `useDocuments(type, ids)` under
 * the hood.
 *
 * Empty relationship data or a `null` model returns an idle handle.
 *
 * @example
 * ```tsx
 * const cards = useHasMany(planbook, "cardStacks");
 * if (cards.isPending) return <Spinner />;
 * return cards.data?.map((c) => <Card key={c.id} card={c} />);
 * ```
 */
export function useHasMany<
  _M extends DocumentTypes = RegisteredTypes,
  Model extends { relationships: Record<string, Relationship | RelationshipArray> } = {
    relationships: Record<string, RelationshipArray>;
  },
  _K extends keyof Model["relationships"] = keyof Model["relationships"],
>(_model: Model | null | undefined, _relationName: _K): DocumentsHandle<unknown> {
  throw new Error("@supergrain/document-store/react/json-api: useHasMany is not yet implemented");
}
