import type { QueryTypes } from "../queries";
import type { DocumentStore, DocumentTypes } from "../store";

import { createContext } from "react";

// Ambient document-store context populated by every Provider returned from
// `createDocumentStoreContext`. Shared so that hooks like `useBelongsTo` and
// `useHasMany` — which aren't tied to a specific factory call — can still
// reach the store in the nearest subtree.
//
// Per-factory Contexts still exist in `./index.ts`: they preserve tight typing
// for `useDocumentStore` / `useDocument` at the call site and enable
// sibling-Provider isolation (each Provider sets both its own Context and
// this ambient one, so each subtree sees its own store).
export const DocumentStoreContext = createContext<DocumentStore<DocumentTypes, QueryTypes> | null>(
  null,
);
