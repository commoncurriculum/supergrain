import type { DocumentTypes, ProcessorContext } from "../store";

/**
 * A to-one JSON-API relationship. `TargetModel` lets `useBelongsTo` infer
 * `DocumentHandle<TargetModel>`. `data: null` means explicitly no related
 * resource.
 *
 * ```ts
 * interface CardStack {
 *   relationships: {
 *     planbook: Relationship<Planbook>;
 *   };
 * }
 * // useBelongsTo(cardStack, "planbook") → DocumentHandle<Planbook>
 * ```
 */
export interface Relationship<TargetModel = unknown> {
  data: { type: string; id: string } | null;
  /** @internal Type-only; never set at runtime. */
  readonly __target?: TargetModel;
}

/**
 * A to-many JSON-API relationship. `TargetModel` lets `useHasMany` infer
 * `ReadonlyArray<DocumentHandle<TargetModel>>`.
 */
export interface RelationshipArray<TargetModel = unknown> {
  data: Array<{ type: string; id: string }>;
  /** @internal Type-only; never set at runtime. */
  readonly __target?: TargetModel;
}

/**
 * A JSON-API resource shape.
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

interface JsonApiEnvelope {
  data?: { id: string; type: string } | ReadonlyArray<{ id: string; type: string }>;
  included?: ReadonlyArray<{ id: string; type: string }>;
}

/**
 * Processor for JSON-API `{ data, included? }` responses. Inserts every
 * resource under its own `type` field, ignoring the requested `type`.
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
  response: unknown,
  { store }: ProcessorContext<M>,
): void {
  const envelope = response as JsonApiEnvelope;
  const data = envelope.data
    ? Array.isArray(envelope.data)
      ? envelope.data
      : [envelope.data]
    : [];
  const included = envelope.included ?? [];
  for (const doc of data) {
    store.insertDocument(doc.type as keyof M & string, doc as unknown as M[keyof M & string]);
  }
  for (const doc of included) {
    store.insertDocument(doc.type as keyof M & string, doc as unknown as M[keyof M & string]);
  }
}
