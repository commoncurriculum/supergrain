import type { Relationship, RelationshipArray } from "../processors/json-api";
import type { DocumentHandle } from "../store";

import { useContext } from "react";

import { DocumentStoreContext } from "./context";

interface WithRelationships {
  relationships: Record<string, Relationship | RelationshipArray>;
}

type BelongsToKeys<Model extends WithRelationships> = {
  [K in keyof Model["relationships"]]: Model["relationships"][K] extends Relationship ? K : never;
}[keyof Model["relationships"]];

type HasManyKeys<Model extends WithRelationships> = {
  [K in keyof Model["relationships"]]: Model["relationships"][K] extends RelationshipArray
    ? K
    : never;
}[keyof Model["relationships"]];

type BelongsToTarget<Model extends WithRelationships, K extends keyof Model["relationships"]> =
  Model["relationships"][K] extends Relationship<infer T> ? T : unknown;

type HasManyTarget<Model extends WithRelationships, K extends keyof Model["relationships"]> =
  Model["relationships"][K] extends RelationshipArray<infer T> ? T : unknown;

/**
 * Resolve a JSON-API to-one relationship to a reactive document handle, typed
 * from `Relationship<T>`. `null` data or a `null`/`undefined` model returns an
 * idle handle.
 *
 * @example
 * ```tsx
 * const planbook = useBelongsTo(cardStack, "planbook");
 * if (planbook.value === undefined) return <Spinner />;
 * return <span>{planbook.value.attributes.title}</span>;
 * ```
 */
export function useBelongsTo<Model extends WithRelationships, RelName extends BelongsToKeys<Model>>(
  model: Model | null | undefined,
  relationName: RelName,
): DocumentHandle<BelongsToTarget<Model, RelName>> {
  const store = useContext(DocumentStoreContext);
  if (store === null) {
    throw new Error(
      "@supergrain/silo/react/json-api: useBelongsTo must be used within the Provider returned by createDocumentStoreContext()",
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

/**
 * Resolve a JSON-API to-many relationship to one reactive handle per related
 * document, typed from `RelationshipArray<T>`. Empty data or a
 * `null`/`undefined` model returns an empty array.
 *
 * @example
 * ```tsx
 * const cards = useHasMany(planbook, "cardStacks");
 * return cards.map((card, i) =>
 *   card.value !== undefined
 *     ? <Card key={card.value.id} card={card.value} />
 *     : <Skeleton key={i} />,
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
      "@supergrain/silo/react/json-api: useHasMany must be used within the Provider returned by createDocumentStoreContext()",
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

/**
 * Same as `useHasMany`; the name signals per-item loading/error UI. Fetches
 * are still batched into one `adapter.find(ids)` call.
 *
 * @example
 * ```tsx
 * const cards = useHasManyIndividually(planbook, "cards");
 * return (
 *   <ul>
 *     {cards.map((c, i) => (
 *       <li key={i}>
 *         {c.value !== undefined ? c.value.attributes.title : <Skeleton />}
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
  const store = useContext(DocumentStoreContext);
  if (store === null) {
    throw new Error(
      "@supergrain/silo/react/json-api: useHasManyIndividually must be used within the Provider returned by createDocumentStoreContext()",
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
