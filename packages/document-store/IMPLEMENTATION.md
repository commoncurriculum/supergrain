# @supergrain/document-store — Implementation Spec

A design document for implementing the document-store read layer. The
class skeletons and failing tests define the contract; this doc explains
the intent and internal mechanics behind them.

---

## Architecture

Five pieces, each with a single responsibility:

```
┌───────────────────────────────────────────────────┐
│  DocumentStore  — public orchestrator             │
│                   find, findMany, findInMemory,   │
│                   insertDocument, clearMemory     │
└───────────┬─────────────────────────┬─────────────┘
            │ delegates reads/writes  │ delegates fetches
            ▼                         ▼
┌───────────────────────┐   ┌─────────────────────────┐
│  MemoryEngine         │   │  Finder                 │
│  reactive in-memory   │   │  batched fetching       │
│  Map<type:id, doc>    │   │  find(type,id) → Promise│
│  insert, find, clear  │   │  dedup + chunk          │
└───────────────────────┘   └───────────┬─────────────┘
                                        │ calls
                                        ▼
                            ┌─────────────────────────┐
                            │  adapter (per-model)    │
                            │  find(ids) → Promise<raw>│
                            └───────────┬─────────────┘
                                        │ raw response
                                        ▼
                            ┌─────────────────────────┐
                            │  processor (per-model)  │
                            │  (raw, store) → docs    │
                            └─────────────────────────┘
```

**DocumentStore** doesn't know how to fetch. **MemoryEngine** doesn't
know about network or handles. **Finder** doesn't know response shapes.
**Processor** doesn't know about batching. **Adapter** is a pure
transport. Each piece is swappable.

> Naming note: the class is `DocumentStore` (not `Store`) to
> disambiguate from `@supergrain/react`'s `StoreProvider` / `useStore`,
> which deals with generic reactive state. A "store" in this package is
> specifically a document-oriented cache keyed by `(type, id)`.

---

## Wiring

DocumentStore and Finder reference each other, so wiring is two-step:

```ts
const finder = new Finder<M>({ models: {...} });       // no store yet
const store  = new DocumentStore<M>({ finder });        // attaches self to finder
```

The `DocumentStore` constructor calls `config.finder.attachStore(this)`.
Calling `finder.find(...)` before a store is attached must throw
synchronously — this is the only case where `finder.find` doesn't return
a pending Promise.

---

## DocumentStore

The `DocumentStore<M>` class is a thin orchestrator that composes a
`MemoryEngine<M>` (reactive cache) and a `Finder<M>` (fetching). All
memory operations delegate to the engine; `find` checks the engine
first and falls back to the finder on miss.

### `find(type, id | null | undefined) → DocumentHandle<T>`

Returns a **stable, reactive handle**. Same `(type, id)` must return
the same handle object on repeat calls.

Logic:

1. `id` is `null`/`undefined` → return an idle handle (all fields at
   their idle invariant values, status `IDLE`).
2. `memoryEngine.find(type, id)` returns a value → return a handle
   with status `SUCCESS`, `data` set, `isPending: false`,
   `isFetching: false`, `hasData: true`, `fetchedAt: <Date>`,
   `promise` pre-resolved.
3. Not in memory → call `finder.find(type, id)` (which queues a
   fetch), return a handle with status `PENDING`, `isPending: true`,
   `isFetching: true`, `promise: <pending>`. When the finder resolves,
   transition the handle to `SUCCESS` (or `ERROR` on rejection).

The handle is **reactive**: reading `handle.data` inside a `tracked()`
scope subscribes to changes. When `insertDocument` writes a new version
of the doc, handles reading it re-render.

### `findMany(type, ids) → DocumentsHandle<T>`

Like `find`, but for a batch. Returns an aggregated reactive handle
with the same state machine rolled up across the set. Empty `ids` →
idle handle. Same `(type, ids)` returns the same handle (identity based
on type + sorted-joined ids).

### `findInMemory(type, id) → T | undefined`

Direct delegation to `memoryEngine.find(type, id)`. Also reactive —
subscribing to a missing doc is valid; when it's later inserted,
dependent scopes re-run.

### `insertDocument(doc) → void`

Delegates to `memoryEngine.insert(doc)`. Keyed by `(doc.type, doc.id)`.
Overwrites any existing document at that key. Fully reactive.

Last-write-wins: no revision tracking, no optimistic conflict resolution
(that belongs in a write layer, not this PR). In particular, if an
`insertDocument` lands **during an in-flight fetch for the same key**,
then:

1. The local insert writes first.
2. When the fetch resolves, its processor calls `insertDocument` with
   the fetched value, which **overwrites** the local insert.
3. No reconciliation — the fetched value wins.

This matches the "read layer has no write semantics" boundary. Apps
that need optimistic writes with reconciliation build on a later
write-layer PR.

### `clearMemory() → void`

Drops every cached document in a single atomic reset (not N per-key
invalidations). Effects on existing handles:

- Handles with `status === "SUCCESS"` flip to `IDLE` if there's no
  in-flight fetch for their key. Their `data` becomes `undefined`, and
  their stable `promise` reference is cleared (replaced by `undefined`).
- Handles with `status === "PENDING"` stay `PENDING` — the fetch is
  still in flight; the result will land on the handle when it returns.
- The in-flight fetch itself is **not cancelled** by `clearMemory` —
  when it resolves, its processor runs `insertDocument` and the
  re-populated doc is observed normally. Cancellation is a separate
  concern (not in this PR).

---

## MemoryEngine

The reactive storage primitive. `DocumentStore` composes one.

```ts
class MemoryEngine<M extends DocumentTypes> {
  insert(doc: M[keyof M]): void;
  find<K extends keyof M & string>(type: K, id: string): M[K] | undefined;
  clear(): void;
}
```

Implementation: a per-document signal keyed by `"<type>:<id>"`.
`insert` writes the signal at that key. `find` reads it. `clear`
resets all signals to `undefined` in a single batch so dependent
scopes re-run once, not N times.

MemoryEngine is deliberately unaware of handles, fetching, or
processing. That keeps its surface minimal and independently
testable.

---

## Finder

The `Finder<M>` class owns the batching pipeline.

Constructor stores:

- `config.models` (adapter + optional processor per type)
- `config.batchWindowMs` (default **15** — roughly one frame / tick; long
  enough to collapse the renders a typical list triggers, short enough to
  not feel laggy)
- `config.batchSize` (default **60** — fits under common backend `IN`
  clause / query-param limits and avoids URL length issues)
- internal `#store: DocumentStore<M> | undefined` (set by `attachStore`)

### `find(type, id) → Promise<T>`

Queues a request, returns a promise that resolves when the document
arrives via the batch pipeline.

Must throw synchronously (not reject) if no store has been attached.
Must throw synchronously if `type` is not in `config.models`.

### `attachStore(store) → void`

Called once by the `DocumentStore` constructor. Stores the reference
internally so batched fetch results can be inserted.

**Called twice**: throws. The library only supports one store per
finder — re-attaching would silently invalidate in-flight deferreds
expecting the original store. Construct a fresh finder if you need a
new one.

---

## Batching pipeline

On each `find(type, id)` call:

1. If `#store.findInMemory(type, id)` returns a value, resolve
   immediately (no queue, no adapter call).
2. Otherwise, check if there's already an in-flight request for
   `(type, id)` — **dedup**. If yes, return that same promise.
3. Otherwise, create a new deferred (promise + resolve/reject), add
   `{ type, id, resolve, reject }` to a pending queue.
4. If no batch timer is running, start one: `setTimeout(drainBatch,
batchWindowMs)`.
5. Return the deferred's promise.

### `drainBatch()`

1. Take the pending queue, group by `type`.
2. For each type group, dedupe ids (preserving the deferred list per
   id — multiple finders for the same id share one fetch).
3. Chunk each type's ids into groups of at most `batchSize`.
4. For each chunk:
   a. Call `adapter.find(ids)`.
   b. On success: pass the raw response to the model's processor
   (`config.models[type].processor ?? defaultProcessor`). The
   processor inserts documents and returns the array of
   requested-id documents. For each deferred: resolve with the
   matching doc by id; if not found in the returned array, reject
   with "document not found".
   c. On adapter error: reject all deferreds for that chunk with the
   error.
5. Clear the batch timer.

### In-flight tracking

Keep a `Map<string, { promise, resolve, reject }>` keyed by
`"<type>:<id>"` for currently-requested documents. Add entries when
a request enters the queue; remove them when the adapter response
resolves or rejects. Concurrent `find(type, id)` calls while in
flight return the existing promise.

### Retries (NOT in this PR)

The Ember finder retries failed fetches with fibonacci backoff. This
spec does NOT include retries. A rejected adapter call rejects the
deferred; the handle flips to `ERROR`. Retry logic is a later
enhancement.

### Refetching (NOT in this PR)

The lifecycle diagram below mentions `SUCCESS → refetch`, but this PR
does not expose an imperative refetch API. `DocumentHandle` has no
`.refetch()` method in this PR. A refetch is observed only as a
side-effect of an external `insertDocument` call with a fresher doc
(e.g. from a socket push, or a write-layer response). Explicit
`refetch()` is a later enhancement.

---

## Adapter

```ts
interface DocumentAdapter {
  find(ids: Array<string>): Promise<unknown>;
}
```

That's it. The adapter is a consumer-owned transport — it decides
URL shape, HTTP method, request/response format. The library never
inspects the raw response; only the processor does.

Adapters throw (reject) on network/server errors. The finder treats
any rejection as a fetch failure for the whole chunk.

---

## Processor

A processor is a **plain function** — no `.process()` method, no
class. Processors are pure stateless transforms; a function is the
right primitive.

```ts
type ResponseProcessor<M, T> = (raw: unknown, store: DocumentStore<M>) => Array<T>;
```

Given the raw adapter response and the store, a processor:

1. Extracts all documents it wants cached (possibly including
   sideloaded docs of other types).
2. Calls `store.insertDocument(doc)` for each.
3. Returns the array of documents matching the originally-requested
   ids — this is what the finder uses to resolve pending deferreds.

### `defaultProcessor` — exported from `/processors`

Used when `ModelConfig.processor` is omitted. Handles the simple case:

```ts
function defaultProcessor(raw, store) {
  const docs = Array.isArray(raw) ? raw : [raw];
  for (const doc of docs) store.insertDocument(doc);
  return docs;
}
```

The adapter returns either a single document or an array of documents.
Each is keyed by its own `type`/`id`. No envelope, no sideloading.

### `jsonApiProcessor` — exported from `/processors/json-api`

For consumers whose API speaks JSON-API–style `{ data, included }`. Opt
in per-model:

```ts
import { jsonApiProcessor } from "@supergrain/document-store/processors/json-api";

new Finder<M>({
  models: {
    user: { adapter: userAdapter, processor: jsonApiProcessor },
    ...
  },
});
```

Concatenates `data + included`, inserts every document by its own
`type`/`id`, and returns `data` (the originally-requested documents).
Sideloaded `included` resources land in the store but aren't returned.

The subpath also exports JSON-API-shape TypeScript helpers:
`Relationship<T>`, `RelationshipArray<T>`, and `JsonApiDocument<Type,
Attrs, Rels>`.

### Custom processors

Consumers can write their own for any other envelope (GraphQL, REST
envelopes, etc.). Just a function with the `ResponseProcessor<M, T>`
signature.

Processors are **synchronous**. If you need async normalization, do it
in the adapter before returning.

### Error handling

If the processor throws, the finder rejects all deferreds for that
chunk with the thrown error. Same semantics as an adapter error.

---

## DocumentHandle

`DocumentHandle<T>` is an **interface**, not a class. Internally the
DocumentStore builds handles as signal-backed reactive objects via
`@supergrain/core` primitives. Consumers never construct a handle
directly — they read them off `DocumentStore.find`.

### Lifecycle

```
IDLE ──(id becomes non-null and not-cached)──► PENDING
IDLE ──(id becomes non-null and cached)─────► SUCCESS

PENDING ──(finder resolves)──► SUCCESS
PENDING ──(finder rejects) ──► ERROR

SUCCESS ──(new insertDocument writes a fresher doc)──► SUCCESS
ERROR   ──(later insertDocument with valid doc)─────► SUCCESS (new promise)
```

**IDLE is one-way.** Once a handle moves off `IDLE` (because its
`(type, id)` had a non-null id), it never returns to `IDLE`. Stable
handle identity is tied to `(type, id)` — if the id changes, the caller
gets a _different_ handle, not the same handle resetting to `IDLE`. The
only way a live handle's `status` becomes `IDLE` again is `clearMemory`
(see `DocumentStore.clearMemory` notes above).

**Stable handle identity**: two calls to `store.find("user", "1")`
return the same object. The handle's fields update reactively — the
reference never changes once created. Implementation: store handles
in a `Map<string, DocumentHandle<any>>` keyed by `"<type>:<id>"`.

**Reactive fields**: `status`, `data`, `error`, `isPending`,
`isFetching`, `hasData`, `fetchedAt`, `promise` are all signals
under the hood, so reads inside a `tracked()` scope re-render on
change.

**`promise` semantics** (for React 19 `use()`):

- `undefined` when IDLE
- Pending on the first fetch
- Resolves once on success, stays resolved across refetches (refetch
  updates `data`/`isFetching`, doesn't replace the promise)
- Rejects once on first error
- If refetch succeeds after an error, create a NEW promise object
  (so a Suspense boundary inside an error boundary can recover)

---

## React binding

`@supergrain/document-store/react` exports two paths:

**Default singleton** — what 95% of apps use:

```ts
import {
  DocumentStoreProvider,
  useDocument,
  useDocuments,
  useDocumentStore,
} from "@supergrain/document-store/react";
```

These are free-standing, bound to a single module-level context. Mount
one `<DocumentStoreProvider init={initStore}>` and the hooks read from
it.

**Factory escape hatch** — for libraries shipping their own document
store, micro-frontends that need isolation, or advanced cases needing
multiple coexisting stores in the same tree:

```ts
import { createDocumentStoreContext } from "@supergrain/document-store/react";

const libStore = createDocumentStoreContext<LibTypes>();
// libStore.Provider, libStore.useDocument, etc. are bound to their own Context
```

Internally, the free-standing exports are literally `defaultContext.*`
where `defaultContext = createDocumentStoreContext()`. Zero runtime
cost for consumers who never touch the factory.

Subpath `useBelongsTo` / `useHasMany` (from `/react/json-api`) compose
on the default context. Libraries using the factory that also want
JSON-API hooks write ~5 lines on top of `libStore.useDocument`.

---

## Testing contracts

Failing tests pin the behavior. Source files map 1:1 to tests:

- `src/memory.ts` ↔ `tests/memory.test.ts` — insert, find, overwrite,
  keying by (type,id), clear
- `src/processors/index.ts` ↔ `tests/processors/index.test.ts` —
  `defaultProcessor` (single doc, array, no envelope unwrap)
- `src/processors/json-api.ts` ↔ `tests/processors/json-api.test.ts` —
  `jsonApiProcessor` (`{data,included}` unwrap, sideload, empty data,
  mixed types)
- `src/finder.ts` ↔ `tests/finder.test.ts` — API surface, batching
  window + custom window, dedup (concurrent + in-flight), chunking
  (default + custom batchSize), processor integration, adapter errors,
  server errors, processor errors
- `src/store.ts` ↔ `tests/store.test.ts` — public API, memory
  delegation, handle state transitions (IDLE/PENDING/SUCCESS/ERROR),
  handle identity, adapter-error bubbling
- `src/react/index.ts` ↔ `tests/react/index.test.tsx` —
  DocumentStoreProvider, useDocumentStore, useDocument (factory path),
  isolation between factory instances
- `src/react/json-api.ts` ↔ `tests/react/json-api.test.tsx` —
  `useBelongsTo`, `useHasMany` API surface

Tests share a single `tests/example-app.ts` that demonstrates all
config options: `ModelConfig.adapter`, `ModelConfig.processor`,
`FinderConfig.batchWindowMs`, `FinderConfig.batchSize`. Network is
faked with MSW (`msw/node`): real fetch-based adapters, intercepted at
the fetch layer, with a request log for assertions.

Before adding implementation, read through these files — the tests
are the source of truth for edge cases this doc doesn't cover.

---

## Reactivity notes

The store is built on `@supergrain/core` signals. Implementation
guidance:

- `MemoryEngine` holds a `Map<string, Signal<T | undefined>>` keyed
  by `"<type>:<id>"`. `insert` writes. `find` reads.
- Each `DocumentHandle` internally subscribes to the per-document
  signal for its `(type, id)` and propagates changes into its own
  reactive fields.
- `clearMemory` resets all document signals to `undefined` in a
  single batch so dependent scopes re-run once, not N times.

---

## Non-goals (not in this PR)

- Writes / dispatch / patches / optimistic updates
- Staleness checking / background revalidation
- Imperative `handle.refetch()` API
- Retry with backoff
- Query service implementation (types only)
- Invalidation plumbing from server push
- Devtools integration
- Offline / disk cache tier (intentionally dropped; to be designed
  separately if needed)
- Cancellation of in-flight fetches (e.g. on `clearMemory` or on
  `DocumentStoreProvider` unmount)
