import { AdapterError, createDocumentStore, type DocumentStore } from "@supergrain/silo";
import { Effect, Schedule } from "effect";

export interface PlanbookRef {
  type: string;
  id: string;
  offset: number;
}

export type TypeToModel = {
  planbooks_for_user: {
    id: string;
    type: "planbooks_for_user";
    results: Array<PlanbookRef>;
    nextOffset: number | null;
  };
  planbook: { id: string; type: "planbook"; title?: string };
};

// Default the store to no retry so failure assertions are deterministic; pass
// a schedule to exercise inheritance of the store default.
export function makeStore(
  retry: Schedule.Schedule<unknown, AdapterError> = Schedule.recurs(0),
): DocumentStore<TypeToModel> {
  return createDocumentStore<TypeToModel>({
    models: {
      planbooks_for_user: { adapter: { find: () => Effect.succeed({ data: [] }) } },
      planbook: { adapter: { find: () => Effect.succeed({ data: [] }) } },
    },
    retry,
  });
}
