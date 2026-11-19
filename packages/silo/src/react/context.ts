import type { QueryTypes } from "../queries";
import type { DocumentStore, DocumentTypes } from "../store";

import { createContext } from "react";

// Every Provider sets this alongside its own typed Context; `useBelongsTo` and
// `useHasMany` are not tied to a factory and read the store from here.
export const DocumentStoreContext = createContext<DocumentStore<DocumentTypes, QueryTypes> | null>(
  null,
);
