---
"@supergrain/silo": major
---

Initial release of `@supergrain/silo` — a reactive document cache for React with first-class request batching. Built on `@supergrain/kernel`'s reactive primitive; documents live in the same reactive graph as the rest of your state.

- **`createDocumentStore(config)`** — plain primitive. Returns `{ find, findInMemory, insertDocument, clearMemory, findQuery, findQueryInMemory, insertQueryResult }`. One reactive tree per store; handles are plain objects nested in that tree.
- **`createDocumentStoreContext<S>()`** (from `@supergrain/silo/react`) — returns `{ Provider, useDocumentStore, useDocument, useQuery }` tied to a fresh React Context. The Provider takes `config: DocumentStoreConfig<M, Q>` (required), optional `initial` for declarative seeding (`{ model: { [type]: { [id]: doc } }, query: { [type]: [{ params, result }] } }`), and optional `onMount: (store) => void` for imperative setup (preloads, subscriptions). The Provider calls `createDocumentStore(config)` exactly once per mount, so SSR requests, tests, and React trees are isolated by construction.
- **Finder** (internal) — batches `find(type, id)` calls within `batchWindowMs` (default 15ms) and chunks at `batchSize` (default 60) per `adapter.find(ids)` call. 50 `useDocument` calls in one render collapse to one network request.
- **Processors** — `defaultProcessor` (any REST endpoint returning `{id, ...}` or `[{id, ...}]`), `defaultQueryProcessor` (results aligned 1:1 with input params by position), and `jsonApiProcessor` (handles `{ data, included }` envelopes; sideloaded docs drop into the documents cache automatically).
- **JSON-API relationship hooks** — `useBelongsTo` / `useHasMany` / `useHasManyIndividually` from `@supergrain/silo/react/json-api`. Type-inferred from `Relationship<T>` / `RelationshipArray<T>`; reach the store via a shared ambient Context populated by every Provider.
- **Module-augmentation `TypeRegistry`** lets consumers declare their document-type map once and get typed hooks everywhere without per-call-site generics.

Handle lifecycle (`IDLE → PENDING → SUCCESS | ERROR`) is pinned property-by-property on a stable handle object — `store.find("user", "1")` returns the same object on every call, with fields that mutate in place when data lands. Suspense via `use(handle.promise)`; the promise reference is stable across `insertDocument` so suspended components don't re-suspend on cache updates.

```tsx
import type { DocumentStore } from "@supergrain/silo";
import { createDocumentStoreContext } from "@supergrain/silo/react";

type DocStore = DocumentStore<TypeToModel, TypeToQuery>;
export const { Provider, useDocument, useDocumentStore, useQuery } =
  createDocumentStoreContext<DocStore>();

// <Provider config={{ models: {...}, queries: {...} }}><App /></Provider>
// const user = useDocument("user", id);
// const dashboard = useQuery("dashboard", { workspaceId: 7 });
```
