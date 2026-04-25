import type { Relationship, RelationshipArray } from "../processors/json-api";
import type { DocumentHandle } from "../store";

import { useContext } from "react";

import { DocumentStoreContext } from "./context";

// =============================================================================
// WithRelationships — any JSON-API model that has a relationships map.
// The map may freely mix belongsTo (`Relationship`) and hasMany
// (`RelationshipArray`) entries; each hook constrains `relationName` to the
// subset of keys whose value matches that hook's relation kind.
// =============================================================================

interface WithRelationships {
  relationships: Record<string, Relationship | RelationshipArray>;
}

/**
 * Keys of `Model["relationships"]` whose value is a `Relationship` (belongsTo).
 * Used to restrict `useBelongsTo`'s `relationName` arg — passing a hasMany
 * key is a compile error.
 */
type BelongsToKeys<Model extends WithRelationships> = {
  [K in keyof Model["relationships"]]: Model["relationships"][K] extends Relationship ? K : never;
}[keyof Model["relationships"]];

/**
 * Keys of `Model["relationships"]` whose value is a `RelationshipArray` (hasMany).
 */
type HasManyKeys<Model extends WithRelationships> = {
  [K in keyof Model["relationships"]]: Model["relationships"][K] extends RelationshipArray
    ? K
    : never;
}[keyof Model["relationships"]];

/**
 * Extract the target model type from a `Relationship<T>` via `infer`.
 */
type BelongsToTarget<Model extends WithRelationships, K extends keyof Model["relationships"]> =
  Model["relationships"][K] extends Relationship<infer T> ? T : unknown;

/**
 * Extract the target model type from a `RelationshipArray<T>` via `infer`.
 */
type HasManyTarget<Model extends WithRelationships, K extends keyof Model["relationships"]> =
  Model["relationships"][K] extends RelationshipArray<infer T> ? T : unknown;

// =============================================================================
// useBelongsTo — JSON-API single-reference relationship → reactive handle
// =============================================================================

/**
 * Resolve a JSON-API `belongsTo` relationship to a reactive document handle.
 *
 * Reads `model.relationships[relationName].data` to get the `{ type, id }`
 * reference, then calls `useDocument(type, id)` under the hood. The return
 * handle's `data` type is inferred from `Relationship<T>` — declare your
 * relationships as `planbook: Relationship<Planbook>` and this hook returns
 * `DocumentHandle<Planbook>` with no cast at the call site.
 *
 * `null` relationship data or a `null`/`undefined` model returns an idle handle.
 *
 * @example
 * ```tsx
 * const planbook = useBelongsTo(cardStack, "planbook");
 * if (planbook.isPending) return <Spinner />;
 * return <span>{planbook.data?.attributes.title}</span>;
 * ```
 */
export function useBelongsTo<Model extends WithRelationships, RelName extends BelongsToKeys<Model>>(
  model: Model | null | undefined,
  relationName: RelName,
): DocumentHandle<BelongsToTarget<Model, RelName>> {
  const store = useContext(DocumentStoreContext);
  if (store === null) {
    throw new Error(
      "@supergrain/silo/react/json-api: useBelongsTo must be used within the Provider returned by createSiloContext()",
    );
  }
  const ref = model?.relationships[relationName as string]?.data as
    | { type: string; id: string }
    | null
    | undefined;
  const type = ref?.type ?? "";
  const id = ref ? ref.id : null;
  // oxlint-disable-next-line no-array-method-this-argument -- DocumentStore#find, not Array#find
  return store.find(type, id) as DocumentHandle<BelongsToTarget<Model, RelName>>;
}

// =============================================================================
// useHasMany — JSON-API to-many relationship → reactive handle list
// =============================================================================

/**
 * Resolve a JSON-API `hasMany` relationship to one reactive handle per
 * related document.
 *
 * Reads `model.relationships[relationName].data` to get the array of
 * `{ type, id }` references, then maps them through `useSilo().find`
 * under the hood. The return handles' `data` type is inferred from
 * `RelationshipArray<T>` — declare your relationships as
 * `cards: RelationshipArray<Card>` and this hook returns
 * `ReadonlyArray<DocumentHandle<Card>>` with no cast at the call site.
 *
 * Empty relationship data or a `null`/`undefined` model returns an empty array.
 *
 * @example
 * ```tsx
 * const cards = useHasMany(planbook, "cardStacks");
 * return cards.map((card, i) =>
 *   card.isPending ? <Skeleton key={i} /> : <Card key={card.data?.id ?? i} card={card.data!} />,
 * );
 * ```
 */
export function useHasMany<Model extends WithRelationships, RelName extends HasManyKeys<Model>>(
  model: Model | null | undefined,
  relationName: RelName,
): ReadonlyArray<DocumentHandle<HasManyTarget<Model, RelName>>> {
  const store = useContext(DocumentStoreContext);
  if (store === null) {
    throw new Error(
      "@supergrain/silo/react/json-api: useHasMany must be used within the Provider returned by createSiloContext()",
    );
  }
  const refs = (model?.relationships[relationName as string]?.data ?? []) as ReadonlyArray<{
    type: string;
    id: string;
  }>;
  return refs.map(
    (ref) =>
      // oxlint-disable-next-line no-array-method-this-argument -- DocumentStore#find, not Array#find
      store.find(ref.type, ref.id) as DocumentHandle<HasManyTarget<Model, RelName>>,
  );
}

// =============================================================================
// useHasManyIndividually — JSON-API to-many relationship → one handle per doc
// =============================================================================

/**
 * Same return shape as `useHasMany`, but named explicitly to emphasize the
 * per-item nature of the result. Use this when each item in the list needs
 * its own loading / error UI — e.g. a list where a skeleton row should
 * appear for each still-loading card, or where one failed card shouldn't
 * prevent the others from rendering.
 *
 * Each handle has its own independent `status`, `data`, `error`, and
 * `promise`. Fetching across the array is still batched into a single
 * `adapter.find(ids)` call by the internal finder — individual handles
 * don't mean individual network requests.
 *
 * Empty relationship data or a `null`/`undefined` model returns an empty array.
 *
 * @example
 * ```tsx
 * const cards = useHasManyIndividually(planbook, "cards");
 * return (
 *   <ul>
 *     {cards.map((c, i) => (
 *       <li key={i}>
 *         {c.isPending ? <Skeleton /> : c.data?.attributes.title}
 *       </li>
 *     ))}
 *   </ul>
 * );
 * ```
 */
export function useHasManyIndividually<
  Model extends WithRelationships,
  RelName extends HasManyKeys<Model>,
>(
  model: Model | null | undefined,
  relationName: RelName,
): ReadonlyArray<DocumentHandle<HasManyTarget<Model, RelName>>> {
  return useHasMany(model, relationName);
}
