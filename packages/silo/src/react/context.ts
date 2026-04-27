import type { QueryTypes } from "../queries";
import type { DocumentTypes, Silo } from "../store";

import { createContext } from "react";

// Ambient silo context populated by every Provider returned from
// `createSiloContext`. Shared so that hooks like `useBelongsTo` and
// `useHasMany` — which aren't tied to a specific factory call — can still
// reach the store in the nearest subtree.
//
// Per-factory Contexts still exist in `./index.ts`: they preserve tight typing
// for `useSilo` / `useDocument` at the call site and enable
// sibling-Provider isolation (each Provider sets both its own Context and
// this ambient one, so each subtree sees its own store).
export const SiloContext = createContext<Silo<DocumentTypes, QueryTypes> | null>(null);
