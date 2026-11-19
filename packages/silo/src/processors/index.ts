import type { QueryProcessorContext, QueryTypes } from "../queries";
import type { DocumentTypes, ProcessorContext } from "../store";

/**
 * Default document processor: inserts the response (one document or an array)
 * under the caller's `type`, keyed by each doc's `id`. No envelope unwrapping;
 * for JSON-API use `jsonApiProcessor` from `@supergrain/silo/processors/json-api`.
 */
export function defaultProcessor<M extends DocumentTypes>(
  response: unknown,
  { store, type }: ProcessorContext<M>,
): void {
  const docs = Array.isArray(response) ? response : [response];
  for (const doc of docs) store.insertDocument(type, doc as M[keyof M & string]);
}

/**
 * Default query processor: pairs `results[i]` with `paramsList[i]` and calls
 * `store.insertQueryResult` for each. Does not normalize nested documents.
 */
export function defaultQueryProcessor<M extends DocumentTypes, Q extends QueryTypes>(
  response: unknown,
  { store, type, paramsList }: QueryProcessorContext<M, Q, keyof Q & string>,
): void {
  const results = response as ReadonlyArray<unknown>;
  for (let i = 0; i < paramsList.length; i++) {
    store.insertQueryResult(
      type,
      paramsList[i] as Q[keyof Q & string]["params"],
      results[i] as Q[keyof Q & string]["result"],
    );
  }
}
