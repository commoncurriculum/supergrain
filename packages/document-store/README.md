# @supergrain/document-store

A reactive document cache for React — Suspense-compatible, request-batched, zero ceremony.

- **Suspense-native** — every handle exposes a stable `promise` for React 19's `use()`. No query keys, no options bags, no `invalidateQueries`.
- **Request batching** — N `useDocument` calls in a render collapse into one `adapter.find(ids)`. No waterfalls.
- **Reactive handles** — `store.find(type, id)` returns a stable object; its fields mutate in place when data lands, when sockets push, when you `insertDocument` locally.
- **Transport-agnostic** — bring your own fetch. Bulk endpoints, fan-out `GET /:id`, websockets, JSON-API envelopes — all work against the same store.
- **Typed by model** — a single `TypeToModel` map drives inference end-to-end; `store.find("user", id)` returns `DocumentHandle<User>` with no casts.

## Install

```bash
npm install @supergrain/document-store @supergrain/core
```

React bindings are optional — `@supergrain/document-store/react` requires `react >= 18.2`.

## Quick start

### 1. Define your models and adapters

```ts
// services/store.ts
import { createDocumentStore, type DocumentAdapter } from "@supergrain/document-store";
import { createDocumentStoreContext } from "@supergrain/document-store/react";

export interface User {
  id: string;
  attributes: { firstName: string; lastName: string };
}
export interface Post {
  id: string;
  attributes: { title: string; body: string };
}

export type TypeToModel = { user: User; post: Post };

const userAdapter: DocumentAdapter = {
  async find(ids) {
    return Promise.all(ids.map((id) => fetch(`/api/users/${id}`).then((r) => r.json())));
  },
};

const postAdapter: DocumentAdapter = {
  async find(ids) {
    return Promise.all(ids.map((id) => fetch(`/api/posts/${id}`).then((r) => r.json())));
  },
};

export const {
  Provider: DocumentStoreProvider,
  useDocumentStore,
  useDocument,
} = createDocumentStoreContext<TypeToModel>();

export function initDocumentStore() {
  return createDocumentStore<TypeToModel>({
    models: {
      user: { adapter: userAdapter },
      post: { adapter: postAdapter },
    },
  });
}
```

Adapters above are **fan-out** style — N parallel `GET /:id` requests, merged. The library doesn't care how you fetch; it just hands the adapter a list of ids and takes back a raw response. If your API exposes a bulk endpoint, one `GET` with all the ids works just as well:

```ts
const userAdapter: DocumentAdapter = {
  async find(ids) {
    const qs = ids.map((id) => `id=${id}`).join("&");
    const res = await fetch(`/api/users?${qs}`);
    return res.json();
  },
};
```

### 2. Mount the Provider

```tsx
// main.tsx
import { DocumentStoreProvider } from "./services/store";
import { initDocumentStore } from "./services/store";

<DocumentStoreProvider init={initDocumentStore}>
  <App />
</DocumentStoreProvider>;
```

Each Provider mount builds a fresh store from the Provider's `init`, so SSR requests and tests are isolated by construction.

### 3. Read documents

```tsx
// UserCard.tsx
import { useDocument } from "@supergrain/document-store/react";

export function UserCard({ id }: { id: string }) {
  const user = useDocument("user", id);

  if (user.isPending) return <Skeleton />;
  if (user.error) return <ErrorState error={user.error} />;
  return <div>{user.data?.attributes.firstName}</div>;
}
```

`useDocument` returns a reactive `DocumentHandle<User>`. Same `(type, id)` always returns the same handle object across renders — fields update in place.

### 4. Or suspend, if you prefer

```tsx
// UserCard.tsx
import { use } from "react";
import { useDocument } from "@supergrain/document-store/react";

export function UserCard({ id }: { id: string }) {
  const user = useDocument("user", id);
  use(user.promise); // suspends on first load; never re-suspends on refetch

  return <div>{user.data!.attributes.firstName}</div>;
}
```

Wrap the component in a `<Suspense>` boundary. That's it. One line to opt in, nothing to configure, no `{ suspense: true }` flag.

## Why this instead of TanStack Query / SWR?

Short version: the same architecture both libraries wish they had started with.

- **No parallel cache.** Documents live in the same reactive graph as the rest of your state. You read them with the same primitives you use for local state.
- **No query keys.** `(type, id)` _is_ the key. Stable, typed, inferred.
- **Request batching as a primitive.** The thing that makes Suspense actually scale isn't the `use()` hook — it's the batch window that collapses 50 component-level `useDocument` calls into one network request. TQ doesn't do this automatically. Here it's the default.
- **No refetch-on-focus / stale-time matrix.** Deliberately — see non-goals. If you need that complexity, reach for TQ. If you don't, don't pay for it.

For a full capability-by-capability breakdown, trade-offs, and migration guidance, see [Comparison to TanStack Query](#comparison-to-tanstack-query) further down.

## API

### `createDocumentStore<M, Q = Record<string, never>>(config)`

The plain, non-React primitive. It takes config and returns the store object.

```ts
const store = createDocumentStore<TypeToModel>({
  models: {
    user: { adapter: userAdapter },
    post: { adapter: postAdapter },
  },
  batchWindowMs: 15, // default — collapse calls within this window
  batchSize: 60, // default — chunk size per adapter.find() call
});
```

Each model can also take a `processor` to normalize the adapter's raw response — see [Processors](#processors) below. Omit it and the default processor assumes the adapter returns a doc or an array of docs.

Methods:

- `find(type, id)` → `DocumentHandle<T>`
- `findInMemory(type, id)` → `T | undefined`
- `insertDocument(type, doc)` → `void`
- `clearMemory()` → `void`
- `findQuery(type, params)` → `QueryHandle<T>`
- `findQueryInMemory(type, params)` → `T | undefined`
- `insertQueryResult(type, params, result)` → `void`

### `createDocumentStoreContext<M, Q = Record<string, never>>()`

The React context wrapper. It mirrors the `createStoreContext()` pattern
from `@supergrain/react`.

```ts
const {
  Provider: DocumentStoreProvider,
  useDocumentStore,
  useDocument,
  useQuery,
} = createDocumentStoreContext<TypeToModel, TypeToQuery>();

<DocumentStoreProvider init={initDocumentStore}>
  <App />
</DocumentStoreProvider>
```

### `DocumentHandle<T>`

A reactive state machine for a single document. All fields are signals — reading them inside a `tracked()` scope subscribes to changes.

```ts
interface DocumentHandle<T> {
  status: "IDLE" | "PENDING" | "SUCCESS" | "ERROR";
  data: T | undefined;
  error: Error | undefined;
  isPending: boolean; // true before first successful load
  isFetching: boolean; // true during any fetch (initial or refetch)
  hasData: boolean;
  fetchedAt: Date | undefined;
  promise: Promise<T> | undefined; // stable; pass to use()
}
```

Lifecycle:

```
IDLE ──(non-null id, cache miss)──► PENDING ──► SUCCESS
IDLE ──(non-null id, cache hit) ──► SUCCESS
PENDING ──(fetch rejects)──► ERROR
ERROR   ──(new data inserted)──► SUCCESS (with a fresh promise object)
```

`IDLE` is one-way — once a handle leaves `IDLE` for a given `(type, id)`, it never goes back. The only exception is `clearMemory()`, which drops handles to `IDLE` when no fetch is in flight.

### React hooks

From `@supergrain/document-store/react`:

- `DocumentStoreProvider({ init, children })` — mounts one store per Provider instance. `init` runs once on mount.
- `useDocument(type, id | null | undefined)` → `DocumentHandle<T>`. `null`/`undefined` id returns an idle handle (useful for conditional fetching — `useDocument("user", isLoggedIn ? myId : null)`).
- `useDocumentStore()` → store API. Escape hatch for imperative ops (`insertDocument`, `clearMemory`, query methods).
- For lists, call `useDocumentStore().find(type, id)` for each id. Batching still happens under the hood; the public primitive stays one resource → one handle.

### Factory for isolated stores

Most apps create one document-store context in their app wiring. Libraries shipping their own document store, micro-frontends, or test harnesses that need isolated instances create their own separate context call:

```ts
import { createDocumentStore } from "@supergrain/document-store";
import { createDocumentStoreContext } from "@supergrain/document-store/react";

const libStore = createDocumentStoreContext<LibTypes>();
export const { Provider, useDocument, useDocumentStore } = libStore;

function initLibStore() {
  return createDocumentStore<LibTypes>({
    models: {
      /* ... */
    },
  });
}
```

The returned Provider/hooks are bound to that specific context factory call.

## Batching, in detail

The Finder is internal — you never construct or import it — but it's what makes the whole thing feel native. Given this tree:

```tsx
<Suspense fallback={<Loading />}>
  {userIds.map((id) => (
    <UserCard key={id} id={id} />
  ))}
</Suspense>
```

…where each `UserCard` calls `useDocument("user", id)` and `use(user.promise)`, here's what happens:

1. Every hook call lands in a pending queue keyed by `(type, id)`.
2. A 15ms timer starts on the first call; further calls in that window join the queue.
3. When the timer fires, ids are deduped, chunked at `batchSize`, and handed to `adapter.find(ids)` — one call per chunk, per type.
4. The processor inserts each returned doc. Every handle waiting on a `(type, id)` whose doc arrived resolves; its Suspense boundary unblocks.

50 `<UserCard>`s → one `/api/users?id=1&id=2&…&id=50` call. Same mechanism works for JSON-API sideloads — if the `user` response includes a related `organization`, the processor inserts both, and any `useDocument("organization", …)` already in flight resolves for free.

## Processors

The adapter returns whatever its fetch chain returns — typically already-parsed JSON. The processor takes that parsed response and calls `store.insertDocument(type, doc)` for every document worth caching.

Processors are **keyed by envelope shape, not by model.** One processor normally serves many adapters: every REST endpoint that returns `{id, ...}` or `[{id, ...}, ...]` shares `defaultProcessor`; every JSON-API endpoint in your app shares `jsonApiProcessor`; a custom `graphqlProcessor` would serve every GraphQL-returning adapter. The per-model `processor` field isn't one-per-adapter — it's "which envelope parser does this adapter's response need."

### Default

If no processor is configured, the library uses `defaultProcessor` — fits any REST endpoint that returns a doc or an array of docs with no wrapping envelope.

You call:

```tsx
const post = useDocument("post", "1");
```

Internally, the store's finder calls your adapter with the queued ids, expecting a shape the default processor understands:

```ts
// finder calls adapter.find(ids); expects either a single doc or an array
await adapter.find(["1", "2"]);
// → [{ id: "1", ... }, { id: "2", ... }]
// or for a single id:
await adapter.find(["1"]);
// → { id: "1", ... }
```

`defaultProcessor` then inserts each doc under the caller's type using the doc's own `id`. No envelope, no sideloading, no type-on-doc requirement.

### JSON-API

For consumers whose API speaks JSON-API. Opt in per-model:

```ts
import { jsonApiProcessor } from "@supergrain/document-store/processors/json-api";

createDocumentStore<M>({
  models: {
    "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
  },
});
```

You call:

```tsx
const cardStack = useDocument("card-stack", "42");
```

Internally, the finder calls your adapter, expecting a JSON-API envelope:

```ts
await adapter.find(["42"]);
// → {
//     data: [
//       { type: "card-stack", id: "42", attributes: { ... },
//         relationships: { planbook: { data: { type: "planbook", id: "7" } } } },
//     ],
//     included: [
//       { type: "planbook", id: "7", attributes: { ... } },
//     ],
//   }
```

`jsonApiProcessor` inserts every document in `data + included`, keyed by each doc's own `type` field from the envelope (JSON-API requires every resource object to carry one). Sideloaded documents drop into their respective caches automatically — so in the example above, `useDocument("planbook", "7")` elsewhere in the tree resolves for free, no extra fetch.

JSON-API relationship hooks live in a separate subpath:

```ts
import { useBelongsTo, useHasMany } from "@supergrain/document-store/react/json-api";

const planbook = useBelongsTo(cardStack, "planbook");
const cards = useHasMany(planbook.data, "cards");
```

- `useBelongsTo(model, relationName)` → `DocumentHandle<Related>`. Reads `model.relationships[relationName].data` (a `{ type, id }`), then delegates to `useDocument`.
- `useHasMany(model, relationName)` → `ReadonlyArray<DocumentHandle<Related>>`. One handle per related doc; fetching is still batched into one adapter call.
- `useHasManyIndividually(model, relationName)` → `ReadonlyArray<DocumentHandle<Related>>`. Same per-doc shape with a name that makes the item-by-item semantics explicit.

### Custom

Any function matching `(raw, store, type) => void` works. If you need GraphQL, a REST envelope, or a bespoke wire format — write one. Processors are synchronous; for async normalization, do it in the adapter.

## Queries

Documents are one surface. The store has a second, additive surface: **queries** — results keyed by structured params objects instead of `id: string`. Use them for endpoints whose response is only meaningful with its query params: dashboards, search results, filtered lists, pagination cursors.

The config surface forks at the top level — `models` for documents, `queries` for params-keyed results. One store, one memory, one finder.

```ts
import { createDocumentStore, type QueryAdapter } from "@supergrain/document-store";

type TypeToModel = { user: User; post: Post };

type TypeToQuery = {
  dashboard: { params: { workspaceId: number }; result: Dashboard };
};

const dashboardAdapter: QueryAdapter<{ workspaceId: number }> = {
  async find(paramsList) {
    return Promise.all(
      paramsList.map((p) => fetch(`/api/dashboard?ws=${p.workspaceId}`).then((r) => r.json())),
    );
  },
};

const store = createDocumentStore<TypeToModel, TypeToQuery>({
  models: {
    user: { adapter: userAdapter },
    post: { adapter: postAdapter },
  },
  queries: {
    dashboard: { adapter: dashboardAdapter },
  },
});
```

Consumers with only documents pass one generic and omit `queries`. The second generic defaults to an empty query map.

### Reading queries

Parallel to `useDocument`/`useDocumentStore.find`:

```tsx
import { useQuery } from "@supergrain/document-store/react";

function DashboardView({ workspaceId }: { workspaceId: number }) {
  const handle = useQuery("dashboard", { workspaceId });

  if (handle.isPending) return <Skeleton />;
  if (handle.error) return <ErrorState error={handle.error} />;
  return <Dashboard data={handle.data!} />;
}
```

Same `QueryHandle<T>` shape as `DocumentHandle<T>` — status/data/error/isPending/isFetching/promise. Same Suspense opt-in via `use(handle.promise)`. Same stable handle identity, so two components requesting `{ workspaceId: 7 }` get the same reactive object.

Object key identity is **deep-equal**: `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hit the same slot. The library stable-stringifies for cache lookup; adapters see the raw objects.

### Method mirror

| Documents                         | Queries                                         |
| --------------------------------- | ----------------------------------------------- |
| `store.find(type, id)`            | `store.findQuery(type, params)`                 |
| `store.findInMemory(type, id)`    | `store.findQueryInMemory(type, params)`         |
| `store.insertDocument(type, doc)` | `store.insertQueryResult(type, params, result)` |
| `useDocument(type, id)`           | `useQuery(type, params)`                        |

### Two ways to handle a list query

Take `GET /api/users?role=admin`. It's a query (keyed by params), and it returns a list of users. There are two reasonable ways to cache it — pick based on whether you need normalization.

#### Option A — plain: store the response as-is (default processor)

Declare the query result as the whole user list. No custom processor needed.

```ts
type TypeToQuery = {
  usersByRole: { params: { role: string }; result: User[] };
};

const usersByRoleAdapter: QueryAdapter<{ role: string }> = {
  async find(paramsList) {
    return Promise.all(
      paramsList.map((p) => fetch(`/api/users?role=${p.role}`).then((r) => r.json())),
    );
  },
};

createDocumentStore<TypeToModel, TypeToQuery>({
  models: { user: { adapter: userAdapter } },
  queries: {
    usersByRole: { adapter: usersByRoleAdapter }, // defaultQueryProcessor
  },
});
```

Usage:

```tsx
const query = useQuery("usersByRole", { role: "admin" });
return query.data?.map((u) => <UserRow key={u.id} user={u} />);
```

What this gives you: 10 lines of config, works immediately, automatic batching of concurrent queries, Suspense-compatible.

What you give up: **no normalization.** The users cached under this query slot are a separate copy from users cached as documents. If someone else calls `store.insertDocument("user", updated42)` — from a detail page load, a socket push, a mutation response — this list keeps showing the old copy of user #42 until the query is re-fetched. Same user, multiple copies, drift.

This is fine when:

- The query result is short-lived or one-shot
- Users showing in this list aren't shown anywhere else
- You're okay re-fetching to see fresh data

#### Option B — normalized: extract documents, store an id-list

Write a custom processor that pulls each user out into the documents cache and stores only a list of ids under the query slot.

```ts
type TypeToQuery = {
  usersByRole: { params: { role: string }; result: { userIds: string[] } };
};

const usersByRoleProcessor: QueryProcessor<TypeToModel, TypeToQuery, "usersByRole"> = (
  raw,
  store,
  type,
  paramsList,
) => {
  const results = raw as Array<User[]>; // adapter returns one User[] per params
  for (let i = 0; i < paramsList.length; i++) {
    const users = results[i];
    // Normalize: insert each user into the documents cache
    for (const u of users) store.insertDocument("user", u);
    // Store only the id-list as the query result
    store.insertQueryResult(type, paramsList[i], { userIds: users.map((u) => u.id) });
  }
};

createDocumentStore<TypeToModel, TypeToQuery>({
  models: { user: { adapter: userAdapter } },
  queries: {
    usersByRole: { adapter: usersByRoleAdapter, processor: usersByRoleProcessor },
  },
});
```

Usage:

```tsx
const query = useQuery("usersByRole", { role: "admin" });

// Dereference each id — each row gets its own reactive handle
return query.data?.userIds.map((id) => <UserRow key={id} id={id} />);
```

What this gives you:

- **One cache entry per user.** Same user shows up in the admin query, the detail page, a sidebar — one reactive object, no drift.
- **Mutations radiate.** `store.insertDocument("user", updated42)` re-renders every view referencing user #42, including this list. No query-cache invalidation, no network call.
- **Small query slot.** Just `{ userIds: [...] }`, not fat user payloads.
- **Cross-query sync.** Another query that returned the same user reads from the same slot; edits propagate everywhere.

What you give up: ~15 extra lines per list-query type for the processor.

This is what Relay and Apollo do with GraphQL schemas; queries here express the same pattern without the schema machinery.

#### Picking between them

Plain → normalized is a local change (swap the result type, add a processor, deref ids instead of users). Start plain, move to normalized when the duplication bites. You don't have to get it right on day one.

### Default query processor

If `QueryConfig.processor` is omitted, the library uses `defaultQueryProcessor` — assumes the adapter returns an array of results aligned 1:1 with the input params, and pairs them by position:

```ts
// adapter returns: [resultForParams0, resultForParams1, ...]
// → insertQueryResult(type, paramsList[i], results[i]) for each
```

No normalization (nested entities stay inside the query result). For normalization, write a custom processor as shown above.

### When to use which

- **Documents** when the data has identity across contexts: entities looked up by id and shared across views. User #42 is the same user whether fetched directly or in a list.
- **Queries** when the data only makes sense with its params: dashboards, search results, pagination cursors, filtered lists. The params _are_ the identity.

Rule of thumb: "Would I ever want `useDocument(type, id)` to read from this cache slot?" If yes → document. If no → query.

## Comparison to TanStack Query

TanStack Query (TQ) and SWR make similar bets; TQ is more feature-complete, so this comparison uses it as the stand-in.

### The architectural difference

Both libraries cache async data, but they make opposite choices about what the cache _is_.

**TQ: opaque caching.** The cache is keyed by an arbitrary `queryKey` array. The library has no idea what's inside a response — a user in the list query and the same user in the detail query are separate cache entries. Simple mental model; no schema needed. Cost: data duplicates across queries, cross-query sync requires manual `setQueryData`, invalidation is pattern-matching across keys.

**document-store: normalized caching.** Responses aren't opaque — the processor knows what types/ids live inside and scatters them into per-`(type, id)` slots. User #42 lives in one place; every view that references them reads the same reactive object.

These aren't "same library, different maturity" — they're genuinely different bets. TQ refuses to normalize because it complicates the mental model. document-store embraces it for the payoff: automatic cross-query sync without explicit invalidation.

### Capability comparison

| Capability                                             | TQ (today) | document-store (today) | document-store (ceiling)                      |
| ------------------------------------------------------ | :--------: | :--------------------: | --------------------------------------------- |
| Fetch by id                                            |     ✓      |           ✓            | —                                             |
| Fetch by arbitrary query                               |     ✓      |           ✗            | generalize adapter keys                       |
| Request dedup                                          |     ✓      |           ✓            | —                                             |
| **Multi-key batching into one request**                |     ✗      |           ✓            | —                                             |
| **Stable-id normalization**                            |     ✗      |           ✓            | —                                             |
| **Cross-query sync (edit user → every view updates)**  | ✗ (manual) |           ✓            | —                                             |
| **Stable reactive handles (fine-grained field reads)** |     ✗      |           ✓            | —                                             |
| Suspense via `use()`                                   | ✓ (opt-in) |       ✓ (opt-in)       | —                                             |
| Invalidation                                           |     ✓      |           ✗            | add `invalidate` / `invalidateType`           |
| Stale-time / gc-time                                   |     ✓      |           ✗            | add `staleMs`; compare against `fetchedAt`    |
| Refetch on focus / reconnect / interval                |     ✓      |           ✗            | add opt-in hooks                              |
| Retry with backoff                                     |     ✓      |           ✗            | add to Finder                                 |
| Cancellation                                           |     ✓      |           ✗            | thread `AbortSignal` through adapter          |
| Pagination / infinite queries                          |     ✓      |           ✗            | wrapper hook that extends an id-list          |
| Mutations + optimistic + rollback                      |     ✓      |           ✗            | next-PR write layer built on `insertDocument` |
| SSR / hydration                                        |     ✓      |           ✗            | serialize MemoryEngine map, rehydrate         |
| Persistence (localStorage / IDB)                       |     ✓      |           ✗            | serialize map on write, restore on init       |
| Devtools                                               |     ✓      |           ✗            | expose cache map + event stream               |
| Ecosystem / community / docs                           |   Large    |         Small          | —                                             |

**Bold rows are architectural** — they live in the primitive and can't be retrofitted without a rewrite. Everything else is **additive**: bolt-on features that land without touching core design. The "ceiling" column is the planned-additive path; none of it requires architectural change to get to.

### What we give up vs TQ

- **Shipped feature count.** TQ has years of polish; we're shipping a read layer. If you need stale-time, refetch-on-focus, mutations, or pagination _today_, TQ wins.
- **Partial-key pattern invalidation.** `invalidateQueries({ queryKey: ['users'] })` in TQ matches every key starting with `['users']`. Our planned `invalidateType('users-by-role')` is blunter — drops everything under a type in one call. Predicate invalidation (`invalidateWhere`) handles the precise cases. Net: ~5% of real-world invalidation needs are less ergonomic.
- **Zero-discipline fetching.** Write `queryFn` and you're done. Here you write adapter + processor + provider wiring. More up-front work; pays off if normalization matters to you.
- **Mature ecosystem.** Persisters, devtools, SSR integrations, community plugins.

### What TQ gives up vs document-store

- **Cross-query sync without manual wiring.** Edit user #42 with `insertDocument("user", updated42)` — every list, detail view, and relationship re-renders instantly, no network call. TQ needs pattern invalidation precisely _because_ it doesn't normalize; each query has its own copy of the data that drifts.
- **Request batching.** 50 `<UserCard id={x} />` components collapse into one network request. TQ has no equivalent built into the primitive.
- **One cache, not two.** TQ almost always sits beside Zustand/Redux/etc. — two caches to reconcile. Our store is both.
- **Fine-grained reactivity.** Reading `handle.data.name` re-renders only when `name` changes. TQ returns a new `{data, isLoading, error}` object every render — whole-handle subscription only, no field-level reads.
- **Simpler invalidation model.** Normalization + reactive propagation handles most of what pattern invalidation exists to solve. You don't need an invalidation graph if mutations just write to the store.

### When to pick which

- **Pick TQ today** if you need stale-time, refetch, mutations, or pagination _shipping now_. If "opaque cache, refetch on events" fits your mental model and you don't want to think about normalization. If your queries don't overlap enough for cross-query sync to matter.
- **Pick document-store** if you want fine-grained reactive state as your primary model and documents should be part of that. If cross-query sync would meaningfully simplify your app (entity updates radiating without keys). If you're okay being on a library with a smaller feature surface today, trusting that the additive features will land.
- **Use both in one app during migration.** Totally viable. TQ for search/list/cursor queries where opacity is fine; document-store for entity reads that benefit from normalization. They don't step on each other.

### Honest caveat

Much of the comparison above contrasts TQ-as-shipped with document-store-as-designed. Some rows (generalized keys, invalidation, mutations) are planned-additive and not in this PR. The _foundation_ is the hard part; those features are ~10-50 LOC each on top. If you're evaluating for a production migration _today_, weight the "today" column, not the "ceiling" column.

## Non-goals (in this version)

These are deliberate — every one was considered and left out for this read layer. Most will land in subsequent packages / PRs.

- Writes, dispatch, optimistic updates — a separate write layer will build on this.
- Stale-time / refetch-on-focus / background revalidation.
- Imperative `handle.refetch()` — observe fresh data by calling `insertDocument` from a socket handler or a mutation response.
- Retry with backoff.
- Server-push invalidation.
- Cancellation of in-flight fetches.
- **Auto-suspending hooks.** `useDocument` returns a handle; it never throws to Suspense on its own. Suspense is a one-line opt-in (`use(handle.promise)`). The reverse — recovering a handle from an auto-suspending hook — isn't possible, so the primitive stays non-suspending and auto-suspend is a trivial wrapper anyone can write.

## License

MIT
